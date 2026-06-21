//! EvoMate Yes Pulse embedded in the Codex TUI.
//!
//! Product rule: the hook prompt stays silent; the user sees a compact live
//! pulse that proves EvoMate is acting. Backend event -> pulse node, predicted
//! yesness -> pulse strength, selected gene -> behavior mode.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use std::time::Instant;
use std::{env, fs};

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Color;
use ratatui::style::Modifier;
use ratatui::style::Style;
use ratatui::text::Line;
use ratatui::text::Span;
use ratatui::text::Text;
use ratatui::widgets::Paragraph;
use ratatui::widgets::Widget;
use serde::Deserialize;

use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::tui::FrameRequester;

const DEFAULT_EVOMATE_API_URL: &str = "http://127.0.0.1:8787";
const POLL_INTERVAL: Duration = Duration::from_millis(1200);
const REQUEST_TIMEOUT: Duration = Duration::from_millis(1500);
const ANIMATION_FRAME: Duration = Duration::from_millis(260);
const IDLE_FRAME: Duration = Duration::from_millis(1000);
const PULSE_TICKS: u64 = 4;

#[derive(Debug, Clone)]
pub(crate) struct EvoMateStatusWidget {
    enabled: bool,
    api_url: String,
    shared: Arc<Mutex<EvoMateSnapshot>>,
    frame_requester: FrameRequester,
    tick: u64,
    last_animation_at: Instant,
    last_seen_event_id: Option<String>,
    event_pulse_started_tick: u64,
}

#[derive(Debug, Clone)]
struct EvoMateSnapshot {
    online: bool,
    cached: bool,
    generation: Option<u64>,
    yesness: Option<f64>,
    understanding: Option<f64>,
    gene_id: Option<String>,
    latest_type: Option<String>,
    latest_summary: Option<String>,
    latest_event_id: Option<String>,
    receipt: Option<String>,
    last_ok_at: Option<Instant>,
    last_error_at: Option<Instant>,
}

impl Default for EvoMateSnapshot {
    fn default() -> Self {
        Self {
            online: false,
            cached: false,
            generation: None,
            yesness: None,
            understanding: None,
            gene_id: None,
            latest_type: None,
            latest_summary: None,
            latest_event_id: None,
            receipt: None,
            last_ok_at: None,
            last_error_at: None,
        }
    }
}

impl EvoMateSnapshot {
    fn connected(&self) -> bool {
        self.online || self.cached
    }

    fn revision_key(&self) -> String {
        format!(
            "{}|{}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}",
            self.online,
            self.cached,
            self.generation,
            self.yesness,
            self.understanding,
            self.gene_id,
            self.latest_type,
            self.latest_summary,
            self.latest_event_id,
            self.receipt
        )
    }
}

#[derive(Debug, Deserialize)]
struct EvolutionStateResponse {
    generation: Option<u64>,
    #[serde(rename = "understandingScore")]
    understanding_score: Option<f64>,
    metrics: Option<EvolutionMetrics>,
    timeline: Option<Vec<EvolutionTimelineItem>>,
}

#[derive(Debug, Deserialize)]
struct EvolutionMetrics {
    #[serde(rename = "yesnessScore")]
    yesness_score: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct EvolutionTimelineItem {
    id: Option<String>,
    #[serde(rename = "type")]
    event_type: Option<String>,
    summary: Option<String>,
    score: Option<f64>,
    #[serde(rename = "geneId")]
    gene_id: Option<String>,
}

impl EvoMateStatusWidget {
    pub(crate) fn new(frame_requester: FrameRequester) -> Self {
        let enabled = std::env::var("EVOMATE_TUI")
            .map(|value| value != "0" && value.to_ascii_lowercase() != "false")
            .unwrap_or(true);
        let api_url = std::env::var("EVOMATE_API_URL")
            .unwrap_or_else(|_| DEFAULT_EVOMATE_API_URL.to_string())
            .trim_end_matches('/')
            .to_string();
        let shared = Arc::new(Mutex::new(EvoMateSnapshot::default()));

        if enabled {
            spawn_poll_loop(api_url.clone(), shared.clone(), frame_requester.clone());
        }

        Self {
            enabled,
            api_url,
            shared,
            frame_requester,
            tick: 0,
            last_animation_at: Instant::now(),
            last_seen_event_id: None,
            event_pulse_started_tick: 0,
        }
    }

    pub(crate) fn desired_height(&self, width: u16) -> u16 {
        if !self.enabled || width < 42 {
            0
        } else if width < 86 {
            2
        } else {
            3
        }
    }

    pub(crate) fn pre_draw_tick(&mut self) {
        if !self.enabled {
            return;
        }

        let now = Instant::now();
        let latest_event_id = self.snapshot().latest_event_id;
        if latest_event_id.is_some() && latest_event_id != self.last_seen_event_id {
            self.last_seen_event_id = latest_event_id;
            self.event_pulse_started_tick = self.tick;
            self.frame_requester.schedule_frame();
        }

        let pulse_age = self.tick.saturating_sub(self.event_pulse_started_tick);
        let frame_interval = if pulse_age < PULSE_TICKS {
            ANIMATION_FRAME
        } else {
            IDLE_FRAME
        };

        if now.saturating_duration_since(self.last_animation_at) >= frame_interval {
            self.tick = self.tick.wrapping_add(1);
            self.last_animation_at = now;
        }

        self.frame_requester.schedule_frame_in(frame_interval);
    }

    pub(crate) fn render(&self, area: Rect, buf: &mut Buffer) {
        if !self.enabled || area.is_empty() {
            return;
        }

        let snapshot = self.snapshot();
        let width = usize::from(area.width);
        let pulse_age = self.tick.saturating_sub(self.event_pulse_started_tick);
        let mut lines = Vec::with_capacity(3);

        lines.push(truncate_line_with_ellipsis_if_overflow(
            self.yes_line(&snapshot, pulse_age),
            width,
        ));
        if area.height > 1 {
            lines.push(truncate_line_with_ellipsis_if_overflow(
                self.pulse_flow_line(&snapshot, pulse_age, width),
                width,
            ));
        }
        if area.height > 2 {
            lines.push(truncate_line_with_ellipsis_if_overflow(
                self.backend_line(&snapshot, pulse_age, width),
                width,
            ));
        }

        Paragraph::new(Text::from(lines)).render(area, buf);
    }

    fn snapshot(&self) -> EvoMateSnapshot {
        self.shared
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| EvoMateSnapshot::default())
    }

    fn yes_line(&self, snapshot: &EvoMateSnapshot, pulse_age: u64) -> Line<'static> {
        let yes = snapshot.yesness.unwrap_or(0.0).clamp(0.0, 1.0);
        let yes_text = snapshot
            .yesness
            .map(format_percent)
            .unwrap_or_else(|| "--".to_string());
        let conf = snapshot
            .understanding
            .map(format_percent)
            .unwrap_or_else(|| "--".to_string());
        let gene = gene_overlay(snapshot.gene_id.as_deref().unwrap_or_default());
        let generation = snapshot
            .generation
            .map(|generation| format!("G{generation}"))
            .unwrap_or_else(|| "G?".to_string());
        let shock = shock_symbol(pulse_age, yes, snapshot.connected());

        let mut spans = vec![
            span("╭─ ", muted()),
            span("YES PULSE ", primary_bold()),
            span(shock, pulse_strong()),
            span("  ", muted()),
            span(yes_bar(yes), pulse_style_for_yes(yes)),
            span(" ", muted()),
            span(yes_text, pulse_strong()),
            span(" ", muted()),
            span(yes_band(yes), primary()),
            span("  ·  ", muted()),
            live_chip(snapshot.online, snapshot.cached),
            span("  ·  ", muted()),
            span(gene.icon, primary_bold()),
            span("  ·  ", muted()),
            span(generation, primary()),
            span("  C", muted()),
            span(conf, primary()),
        ];

        if !snapshot.online {
            spans.push(span("  api:", muted()));
            spans.push(span(compact(&self.api_url, 26), offline_style()));
        }

        Line::from(spans)
    }

    fn pulse_flow_line(
        &self,
        snapshot: &EvoMateSnapshot,
        pulse_age: u64,
        width: usize,
    ) -> Line<'static> {
        let stage = runtime_stage(snapshot);
        let display_step = replay_step(stage.step, pulse_age);
        let yes = snapshot.yesness.unwrap_or(0.0).clamp(0.0, 1.0);
        let mut spans = vec![span("│ ", muted()), span("EVOLVE ", muted())];
        spans.extend(yes_meter_spans(yes, snapshot.connected()));
        spans.push(span("  ", muted()));
        spans.extend(flow_pulse_spans(
            display_step,
            stage.step,
            pulse_age,
            snapshot.connected(),
        ));
        if width >= 110 {
            spans.push(span("  ", muted()));
            spans.push(span(
                if display_step < stage.step {
                    "replaying real hook→inject"
                } else {
                    stage.user_effect
                },
                primary_bold(),
            ));
        }
        Line::from(spans)
    }

    fn backend_line(
        &self,
        snapshot: &EvoMateSnapshot,
        pulse_age: u64,
        width: usize,
    ) -> Line<'static> {
        let stage = runtime_stage(snapshot);
        let event = snapshot
            .latest_type
            .as_deref()
            .map(short_event)
            .unwrap_or("standby");
        let age = snapshot
            .last_ok_at
            .map(|instant| format_age(instant.elapsed()))
            .or_else(|| {
                snapshot
                    .last_error_at
                    .map(|instant| format_age(instant.elapsed()))
            })
            .unwrap_or_else(|| "never".to_string());
        let backend_state = if snapshot.online {
            if pulse_age < 10 { "LIVE+" } else { "LIVE" }
        } else if snapshot.cached {
            "CACHE"
        } else {
            "OFFLINE"
        };

        let mut spans = vec![
            span("╰─ ", muted()),
            span("REAL ", muted()),
            span(
                backend_state,
                if snapshot.connected() {
                    pulse_strong()
                } else {
                    offline_style()
                },
            ),
        ];

        if let Some(receipt) = snapshot.receipt.as_deref() {
            spans.push(span("  ", muted()));
            spans.push(span(
                compact(receipt, if width >= 112 { 74 } else { 52 }),
                primary_bold(),
            ));
            spans.push(span("  ", muted()));
            spans.push(span(age, muted()));
        } else {
            spans.push(span(" → ", muted()));
            spans.push(span(stage.label, primary_bold()));
            spans.push(span("  ·  ", muted()));
            spans.push(span(event, primary()));
            spans.push(span("  ·  ", muted()));
            spans.push(span(age, muted()));
        }

        if width >= 124 {
            if let Some(summary) = snapshot.latest_summary.as_deref() {
                spans.push(span("  // ", muted()));
                spans.push(span(compact(summary, 28), muted()));
            }
        }

        Line::from(spans)
    }
}

fn spawn_poll_loop(
    api_url: String,
    shared: Arc<Mutex<EvoMateSnapshot>>,
    frame_requester: FrameRequester,
) {
    if let Err(err) = thread::Builder::new()
        .name("evomate-status-poller".to_string())
        .spawn(move || {
            let client = match reqwest::blocking::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .connect_timeout(REQUEST_TIMEOUT)
                .no_proxy()
                .build()
            {
                Ok(client) => client,
                Err(err) => {
                    tracing::debug!(%err, "failed to build EvoMate status client");
                    return;
                }
            };
            let state_urls = state_urls(&api_url);

            loop {
                let next = poll_once(&client, &state_urls);
                let mut changed = false;
                if let Ok(mut guard) = shared.lock() {
                    let old_revision = guard.revision_key();
                    *guard = next;
                    changed = old_revision != guard.revision_key();
                }
                if changed {
                    frame_requester.schedule_frame();
                }
                thread::sleep(POLL_INTERVAL);
            }
        })
    {
        tracing::debug!(%err, "failed to spawn EvoMate status poller");
    }
}

fn poll_once(client: &reqwest::blocking::Client, state_urls: &[String]) -> EvoMateSnapshot {
    let now = Instant::now();
    for state_url in state_urls {
        match client.get(state_url).send() {
            Ok(response) if response.status().is_success() => {
                match response.json::<EvolutionStateResponse>() {
                    Ok(state) => return snapshot_from_state(state, now, true, false),
                    Err(err) => {
                        tracing::debug!(%err, %state_url, "failed to decode EvoMate state");
                    }
                }
            }
            Ok(response) => {
                tracing::debug!(status = %response.status(), %state_url, "EvoMate state endpoint returned non-success");
            }
            Err(err) => {
                tracing::debug!(%err, %state_url, "failed to poll EvoMate state");
            }
        }
    }

    if let Some(snapshot) = read_state_file_fallback(now) {
        return snapshot;
    }

    EvoMateSnapshot {
        last_error_at: Some(now),
        ..EvoMateSnapshot::default()
    }
}

fn snapshot_from_state(
    state: EvolutionStateResponse,
    now: Instant,
    online: bool,
    cached: bool,
) -> EvoMateSnapshot {
    let timeline = state.timeline.as_ref();
    let latest = timeline.and_then(|items| items.first());
    let gene_id = timeline.and_then(|items| items.iter().find_map(|item| item.gene_id.clone()));
    let runtime_yesness = timeline.and_then(|items| {
        items
            .iter()
            .find(|item| item.event_type.as_deref().is_some_and(is_yesness_event))
            .and_then(|item| item.score)
    });
    let runtime_confidence = timeline.and_then(|items| {
        items
            .iter()
            .find(|item| item.event_type.as_deref() == Some("semantic_parsed"))
            .and_then(|item| item.score)
    });
    let latest_type = latest.and_then(|item| item.event_type.clone());
    let latest_summary = latest.and_then(|item| item.summary.clone());
    let latest_event_id = latest.and_then(|item| item.id.clone());
    let receipt = build_receipt(
        timeline,
        gene_id.as_deref(),
        runtime_yesness,
        runtime_confidence,
    );

    EvoMateSnapshot {
        online,
        cached,
        generation: state.generation,
        yesness: runtime_yesness
            .or_else(|| state.metrics.and_then(|metrics| metrics.yesness_score)),
        understanding: runtime_confidence.or(state.understanding_score),
        gene_id,
        latest_type,
        latest_summary,
        latest_event_id,
        receipt,
        last_ok_at: Some(now),
        last_error_at: None,
    }
}

fn build_receipt(
    timeline: Option<&Vec<EvolutionTimelineItem>>,
    gene_id: Option<&str>,
    yesness: Option<f64>,
    confidence: Option<f64>,
) -> Option<String> {
    let items = timeline?;
    let recent = items.iter().take(8).collect::<Vec<_>>();
    let has_inject = recent
        .iter()
        .any(|item| item.event_type.as_deref() == Some("advisor_injected"));
    let has_vote = recent
        .iter()
        .any(|item| item.event_type.as_deref() == Some("tournament_completed"));
    let has_semantic = recent
        .iter()
        .any(|item| item.event_type.as_deref() == Some("semantic_parsed"));
    let hook = recent
        .iter()
        .find(|item| item.event_type.as_deref() == Some("hook_received"));

    if !has_inject && !has_vote && !has_semantic && hook.is_none() {
        return None;
    }

    let hook_part = hook
        .and_then(|item| item.summary.as_deref())
        .and_then(captured_chars)
        .unwrap_or_else(|| "hook".to_string());
    let sem_part = confidence
        .map(format_percent)
        .unwrap_or_else(|| "--".to_string());
    let yes_part = yesness
        .map(format_percent)
        .unwrap_or_else(|| "--".to_string());
    let gene_part = gene_overlay(gene_id.unwrap_or_default()).icon;

    Some(format!(
        "RECEIPT hook {hook_part} → sem {sem_part} → vote {yes_part} → inject {gene_part}"
    ))
}

fn captured_chars(summary: &str) -> Option<String> {
    let marker = "captured ";
    let start = summary.find(marker)? + marker.len();
    let value = summary[start..].split_whitespace().next()?;
    if value.chars().all(|ch| ch.is_ascii_digit()) {
        Some(format!("{value}c"))
    } else {
        None
    }
}

fn is_yesness_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "advisor_injected"
            | "tournament_completed"
            | "gene_selected"
            | "agent_event_observed"
            | "gep_assets_written"
            | "remote_job_imported"
    ) || event_type.starts_with("policy_reward_")
}

fn state_urls(api_url: &str) -> Vec<String> {
    let primary = format!("{api_url}/api/evolution/state");
    let localhost = "http://localhost:8787/api/evolution/state".to_string();
    if primary == localhost {
        vec![primary]
    } else {
        vec![primary, localhost]
    }
}

fn read_state_file_fallback(now: Instant) -> Option<EvoMateSnapshot> {
    for path in state_file_candidates() {
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        match serde_json::from_str::<EvolutionStateResponse>(&raw) {
            Ok(state) => return Some(snapshot_from_state(state, now, false, true)),
            Err(err) => {
                tracing::debug!(%err, path = %path.display(), "failed to decode EvoMate state file fallback");
            }
        }
    }
    None
}

fn state_file_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(file) = env::var("EVOMATE_STATE_FILE") {
        candidates.push(PathBuf::from(file));
    }
    if let Ok(dir) = env::var("EVOMATE_STATE_DIR") {
        candidates.push(PathBuf::from(dir).join("evolution-state.json"));
    }
    if let Ok(mut cwd) = env::current_dir() {
        loop {
            candidates.push(cwd.join("memory/evomate/evolution-state.json"));
            candidates.push(cwd.join("evo-predict-agent/memory/evomate/evolution-state.json"));
            if !cwd.pop() {
                break;
            }
        }
    }
    candidates
}

#[derive(Debug, Clone, Copy)]
struct RuntimeStage {
    label: &'static str,
    step: usize,
    user_effect: &'static str,
}

#[derive(Debug, Clone, Copy)]
struct GeneOverlay {
    icon: &'static str,
}

fn runtime_stage(snapshot: &EvoMateSnapshot) -> RuntimeStage {
    if !snapshot.connected() {
        return RuntimeStage {
            label: "offline",
            step: 0,
            user_effect: "waiting for EvoMate",
        };
    }

    match snapshot.latest_type.as_deref().unwrap_or("idle") {
        "hook_received" => RuntimeStage {
            label: "01 hook captured",
            step: 1,
            user_effect: "listening",
        },
        "semantic_parsed" => RuntimeStage {
            label: "02 semantic parsed",
            step: 2,
            user_effect: "understanding",
        },
        "tournament_completed" | "gene_selected" | "agent_event_observed" => RuntimeStage {
            label: "03 gene selected",
            step: 3,
            user_effect: "choosing behavior",
        },
        "advisor_injected" => RuntimeStage {
            label: "04 advisor injected",
            step: 4,
            user_effect: "guiding this turn",
        },
        "gep_assets_written" => RuntimeStage {
            label: "05 memory evolved",
            step: 5,
            user_effect: "learning outcome",
        },
        "remote_job_queued" => RuntimeStage {
            label: "06 train queued",
            step: 6,
            user_effect: "training queued",
        },
        "remote_job_imported" => RuntimeStage {
            label: "06 model upgraded",
            step: 6,
            user_effect: "next generation ready",
        },
        event_type if event_type.starts_with("policy_reward_") => RuntimeStage {
            label: "05 reward applied",
            step: 5,
            user_effect: "reinforcing behavior",
        },
        "direction_locked" => RuntimeStage {
            label: "idle",
            step: 0,
            user_effect: "standing by",
        },
        _ => RuntimeStage {
            label: "idle",
            step: 0,
            user_effect: "standing by",
        },
    }
}

fn gene_overlay(gene_id: &str) -> GeneOverlay {
    match gene_id {
        "gene_ask_before_execution" => GeneOverlay { icon: "SAFE" },
        "gene_concise_direct_answer" => GeneOverlay { icon: "FAST" },
        "gene_mcp_first_architecture" => GeneOverlay { icon: "MCP" },
        "gene_deep_research_first" => GeneOverlay { icon: "SRC" },
        "gene_visualize_first" => GeneOverlay { icon: "VIS" },
        "gene_yes_engineer_policy" => GeneOverlay { icon: "EVO" },
        _ => GeneOverlay { icon: "YES" },
    }
}

fn yes_meter_spans(yes: f64, online: bool) -> Vec<Span<'static>> {
    let cells = 10usize;
    let filled = ((yes.clamp(0.0, 1.0) * cells as f64).round() as usize).min(cells);
    let mut spans = Vec::with_capacity(cells);
    for idx in 0..cells {
        if !online {
            spans.push(span("·", muted()));
        } else if idx < filled {
            spans.push(span("━", pulse_strong()));
        } else {
            spans.push(span("·", primary_dim()));
        }
    }
    spans
}

fn replay_step(target_step: usize, pulse_age: u64) -> usize {
    if target_step <= 1 || pulse_age >= PULSE_TICKS {
        return target_step;
    }
    let replay = (pulse_age as usize + 1).min(target_step);
    replay.max(1)
}

fn flow_pulse_spans(
    display_step: usize,
    target_step: usize,
    pulse_age: u64,
    online: bool,
) -> Vec<Span<'static>> {
    const LABELS: [&str; 6] = ["hook", "sem", "vote", "inject", "gep", "train"];
    let active_idx = if display_step == 0 {
        0
    } else {
        display_step.saturating_sub(1).min(5)
    };
    let shock = pulse_age < 12;
    let mut spans = Vec::new();

    for (idx, label) in LABELS.iter().enumerate() {
        if idx > 0 {
            spans.extend(connector_spans(idx, display_step, target_step, online));
        }

        let done = online && idx < display_step;
        let future_done = online && idx < target_step;
        let active = online && idx == active_idx && (display_step > 0 || shock);
        let node = if !online {
            "○"
        } else if active {
            "◉"
        } else if done {
            "●"
        } else {
            "○"
        };
        let style = if active {
            pulse_strong()
        } else if done {
            primary()
        } else if future_done {
            primary_dim()
        } else {
            muted()
        };
        spans.push(span(node, style));
        spans.push(span(
            *label,
            if done || future_done {
                primary_dim()
            } else {
                muted()
            },
        ));
    }

    spans
}

fn connector_spans(
    connector_idx: usize,
    display_step: usize,
    target_step: usize,
    online: bool,
) -> Vec<Span<'static>> {
    let mut spans = Vec::with_capacity(3);
    let completed_connector = online && connector_idx < display_step;
    let future_connector = online && connector_idx < target_step;

    for _ in 0..3 {
        if completed_connector {
            spans.push(span("━", primary_dim()));
        } else if future_connector {
            spans.push(span("·", primary_dim()));
        } else {
            spans.push(span("·", muted()));
        }
    }

    spans
}

fn yes_bar(value: f64) -> String {
    let cells = 10usize;
    let filled = ((value.clamp(0.0, 1.0) * cells as f64).round() as usize).min(cells);
    format!("{}{}", "█".repeat(filled), "░".repeat(cells - filled))
}

fn yes_band(value: f64) -> &'static str {
    if value >= 0.78 {
        "High Yes"
    } else if value >= 0.58 {
        "Guided Yes"
    } else if value >= 0.42 {
        "Cautious Yes"
    } else {
        "Repair Yes"
    }
}

fn shock_symbol(pulse_age: u64, yes: f64, online: bool) -> &'static str {
    if !online {
        return "○";
    }
    let high_yes = yes >= 0.58;
    match pulse_age % 6 {
        0 => {
            if high_yes {
                "◉"
            } else {
                "◎"
            }
        }
        1 => "◎",
        2 => "●",
        3 => "◌",
        4 => "●",
        _ => "◎",
    }
}

fn live_chip(online: bool, cached: bool) -> Span<'static> {
    if online {
        span("LIVE", pulse_strong())
    } else if cached {
        span("CACHE", primary_bold())
    } else {
        span("OFFLINE", offline_style())
    }
}

fn short_event(event_type: &str) -> &'static str {
    match event_type {
        "hook_received" => "hook",
        "semantic_parsed" => "semantic",
        "tournament_completed" => "tournament",
        "gene_selected" => "gene",
        "agent_event_observed" => "observe",
        "advisor_injected" => "inject",
        "gep_assets_written" => "GEP",
        "remote_job_queued" => "remote",
        "remote_job_imported" => "trained",
        event_type if event_type.starts_with("policy_reward_") => "reward",
        "direction_locked" => "idle",
        _ => "event",
    }
}

fn span(content: impl Into<String>, style: Style) -> Span<'static> {
    Span::styled(content.into(), style)
}

fn primary_bold() -> Style {
    Style::default()
        .fg(Color::Rgb(25, 255, 190))
        .add_modifier(Modifier::BOLD)
}

fn primary() -> Style {
    Style::default().fg(Color::Rgb(25, 220, 180))
}

fn primary_dim() -> Style {
    Style::default().fg(Color::Rgb(22, 150, 130))
}

fn pulse_strong() -> Style {
    Style::default()
        .fg(Color::Rgb(180, 255, 85))
        .add_modifier(Modifier::BOLD)
}

fn pulse_style_for_yes(yes: f64) -> Style {
    if yes >= 0.58 {
        pulse_strong()
    } else {
        primary_bold()
    }
}

fn offline_style() -> Style {
    Style::default()
        .fg(Color::Rgb(255, 180, 80))
        .add_modifier(Modifier::BOLD)
}

fn muted() -> Style {
    Style::default().add_modifier(Modifier::DIM)
}

fn compact(value: &str, max_chars: usize) -> String {
    let value = value.trim();
    let count = value.chars().count();
    if count <= max_chars {
        return value.to_string();
    }
    let keep = max_chars.saturating_sub(1);
    let mut out = value.chars().take(keep).collect::<String>();
    out.push('…');
    out
}

fn format_percent(value: f64) -> String {
    format!("{:.0}%", value.clamp(0.0, 1.0) * 100.0)
}

fn format_age(duration: Duration) -> String {
    let seconds = duration.as_secs();
    if seconds < 1 {
        "now".to_string()
    } else if seconds < 60 {
        format!("{seconds}s")
    } else {
        format!("{}m", seconds / 60)
    }
}
