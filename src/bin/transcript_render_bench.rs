use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::env;
use std::process::ExitCode;
use std::rc::Rc;
use std::time::{Duration, Instant};

use adw::prelude::*;
use gtk::{gio, glib};
use sele_core::{
    TranscriptBlock, TranscriptBlockKind, TranscriptMessage, TranscriptMessageState,
    TranscriptRole, TranscriptSessionKey,
};
use sele_store::TranscriptStore;

#[path = "../components/chat_view/message_row.rs"]
mod message_renderer;

const APPLICATION_ID: &str = "dev.sele.TranscriptRenderBench";
const SETTLE_FRAMES: u32 = 10;
const MIN_INITIAL_FRAMES: u32 = 30;
const WARMUP_FRAMES: u32 = 30;
const MAX_SETTLE_FRAMES: u32 = 600;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Renderer {
    BlockList,
    MessageList,
    ListBox,
    Box,
    TextView,
}

impl Renderer {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "block-list" | "chunks" => Some(Self::BlockList),
            "message-list" | "reuse" => Some(Self::MessageList),
            "list-box" => Some(Self::ListBox),
            "box" => Some(Self::Box),
            "text-view" => Some(Self::TextView),
            _ => None,
        }
    }

    const fn name(self) -> &'static str {
        match self {
            Self::BlockList => "block-list",
            Self::MessageList => "message-list",
            Self::ListBox => "list-box",
            Self::Box => "box",
            Self::TextView => "text-view",
        }
    }
}

#[derive(Clone, Debug)]
struct Config {
    renderer: Renderer,
    messages: u32,
    frames: u32,
    pixels_per_frame: f64,
    prepend_messages: u32,
    copies: u32,
    provider: Option<String>,
    session: Option<String>,
}

impl Config {
    fn from_args() -> Result<Self, String> {
        let mut config = Self {
            renderer: Renderer::BlockList,
            messages: 500,
            frames: 240,
            pixels_per_frame: 1_200.0,
            prepend_messages: 20,
            copies: 1,
            provider: None,
            session: None,
        };
        for argument in env::args().skip(1) {
            if let Some(value) = argument.strip_prefix("--renderer=") {
                config.renderer = Renderer::parse(value).ok_or_else(|| {
                    "--renderer must be block-list, message-list, list-box, box, or text-view"
                        .to_owned()
                })?;
            } else if let Some(value) = argument
                .strip_prefix("--messages=")
                .or_else(|| argument.strip_prefix("--rows="))
            {
                config.messages = parse_positive_u32("messages", value)?;
            } else if let Some(value) = argument.strip_prefix("--frames=") {
                config.frames = parse_positive_u32("frames", value)?;
            } else if let Some(value) = argument.strip_prefix("--pixels-per-frame=") {
                config.pixels_per_frame = parse_positive_f64("pixels-per-frame", value)?;
            } else if let Some(value) = argument.strip_prefix("--prepend-messages=") {
                config.prepend_messages = parse_positive_u32("prepend-messages", value)?;
            } else if let Some(value) = argument.strip_prefix("--copies=") {
                config.copies = parse_positive_u32("copies", value)?;
            } else if let Some(value) = argument.strip_prefix("--provider=") {
                config.provider = Some(value.to_owned());
            } else if let Some(value) = argument.strip_prefix("--session=") {
                config.session = Some(value.to_owned());
            } else {
                return Err(format!("unknown argument: {argument}"));
            }
        }
        if config.provider.is_some() != config.session.is_some() {
            return Err("--provider and --session must be provided together".into());
        }
        Ok(config)
    }
}

fn parse_positive_u32(name: &str, value: &str) -> Result<u32, String> {
    value
        .parse::<u32>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("--{name} must be a positive integer"))
}

fn parse_positive_f64(name: &str, value: &str) -> Result<f64, String> {
    value
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| format!("--{name} must be a positive number"))
}

fn main() -> ExitCode {
    let config = match Config::from_args() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::FAILURE;
        }
    };
    let application = adw::Application::builder()
        .application_id(APPLICATION_ID)
        .flags(gio::ApplicationFlags::NON_UNIQUE)
        .build();
    application.connect_startup(|_| load_styles());
    application.connect_activate(move |application| {
        build_benchmark(application, config.clone());
    });
    let result = application.run_with_args(&["transcript-render-bench"]);
    if result == glib::ExitCode::SUCCESS {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn load_styles() {
    let stylesheet = format!(
        "{}\n{}",
        include_str!("../../assets/style.css"),
        include_str!("../components/chat_view/style.css")
    );
    let provider = gtk::CssProvider::new();
    provider.load_from_string(&stylesheet);
    let display = gtk::gdk::Display::default().expect("benchmark requires a display");
    gtk::style_context_add_provider_for_display(
        &display,
        &provider,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
}

#[derive(Clone, Default)]
struct BoundRows(Rc<RefCell<HashMap<i64, glib::WeakRef<gtk::Widget>>>>);

impl BoundRows {
    fn bind(&self, sequence: i64, row: &gtk::Widget) {
        self.0
            .borrow_mut()
            .retain(|_, weak| weak.upgrade().is_some_and(|bound_row| bound_row != *row));
        self.0.borrow_mut().insert(sequence, row.downgrade());
    }

    fn unbind(&self, row: &gtk::Widget) {
        self.0
            .borrow_mut()
            .retain(|_, weak| weak.upgrade().is_some_and(|bound_row| bound_row != *row));
    }

    fn visible_anchor(&self, viewport: &gtk::ScrolledWindow) -> Option<(i64, f32)> {
        let viewport_height = viewport.height() as f32;
        let mut candidates = Vec::new();
        self.0.borrow_mut().retain(|sequence, weak| {
            let Some(row) = weak.upgrade() else {
                return false;
            };
            if let Some(bounds) = row.compute_bounds(viewport) {
                let top = bounds.y();
                let bottom = top + bounds.height();
                if bottom > 0.0 && top < viewport_height {
                    candidates.push((*sequence, top));
                }
            }
            true
        });
        candidates.into_iter().min_by(|left, right| {
            left.1
                .partial_cmp(&right.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    }

    fn top_for(&self, sequence: i64, viewport: &gtk::ScrolledWindow) -> Option<f32> {
        self.0
            .borrow()
            .get(&sequence)
            .and_then(glib::WeakRef::upgrade)
            .and_then(|row| row.compute_bounds(viewport))
            .map(|bounds| bounds.y())
    }
}

#[derive(Clone, Copy)]
enum ListProjection {
    Blocks,
    Messages,
}

struct TextRenderer {
    view: gtk::TextView,
    role_tag: gtk::TextTag,
    code_tag: gtk::TextTag,
}

enum BenchContent {
    List {
        store: gio::ListStore,
        rows: BoundRows,
        projection: ListProjection,
    },
    ListBox {
        list: gtk::ListBox,
        rows: BoundRows,
    },
    Box {
        container: gtk::Box,
        rows: BoundRows,
        compensate: Rc<Cell<bool>>,
        previous_upper: Rc<Cell<f64>>,
    },
    Text(TextRenderer),
}

enum Anchor {
    Sequence { sequence: i64, top: f32 },
    Text { mark: gtk::TextMark, top: f32 },
}

impl BenchContent {
    fn install_adjustment_handler(&self, adjustment: &gtk::Adjustment) {
        let Self::Box {
            compensate,
            previous_upper,
            ..
        } = self
        else {
            return;
        };
        previous_upper.set(adjustment.upper());
        let compensate = Rc::clone(compensate);
        let previous_upper = Rc::clone(previous_upper);
        let adjustment = adjustment.downgrade();
        adjustment
            .upgrade()
            .expect("adjustment is alive while installing its handler")
            .connect_local("notify::upper", true, move |_| {
                let adjustment = adjustment.upgrade()?;
                let upper = adjustment.upper();
                let old_upper = previous_upper.replace(upper);
                if compensate.get() && old_upper > 0.0 {
                    let delta = upper - old_upper;
                    glib::idle_add_local_once(move || {
                        adjustment.set_value(adjustment.value() + delta);
                    });
                }
                None
            });
    }

    fn enable_anchor_compensation(&self) {
        if let Self::Box { compensate, .. } = self {
            compensate.set(true);
        }
    }

    fn prepend(&self, messages: Vec<TranscriptMessage>) {
        match self {
            Self::List {
                store, projection, ..
            } => {
                let additions = match projection {
                    ListProjection::Blocks => message_renderer::render_items(messages),
                    ListProjection::Messages => messages
                        .into_iter()
                        .map(glib::BoxedAnyObject::new)
                        .collect(),
                };
                store.splice(0, 0, &additions);
            }
            Self::ListBox { list, rows } => {
                for message in messages.into_iter().rev() {
                    let row = message_renderer::materialized_message_row(&message);
                    rows.bind(message.sequence, row.upcast_ref());
                    list.prepend(&row);
                }
            }
            Self::Box {
                container, rows, ..
            } => {
                for message in messages.into_iter().rev() {
                    let row = message_renderer::materialized_message_row(&message);
                    rows.bind(message.sequence, row.upcast_ref());
                    container.prepend(&row);
                }
            }
            Self::Text(renderer) => renderer.insert_messages(messages, true),
        }
    }

    fn visible_anchor(&self, viewport: &gtk::ScrolledWindow) -> Option<Anchor> {
        match self {
            Self::List { rows, .. } | Self::ListBox { rows, .. } | Self::Box { rows, .. } => rows
                .visible_anchor(viewport)
                .map(|(sequence, top)| Anchor::Sequence { sequence, top }),
            Self::Text(renderer) => renderer.visible_anchor(),
        }
    }

    fn anchor_top(&self, anchor: &Anchor, viewport: &gtk::ScrolledWindow) -> Option<f32> {
        match (self, anchor) {
            (
                Self::List { rows, .. } | Self::ListBox { rows, .. } | Self::Box { rows, .. },
                Anchor::Sequence { sequence, .. },
            ) => rows.top_for(*sequence, viewport),
            (Self::Text(renderer), Anchor::Text { mark, .. }) => renderer.mark_top(mark),
            _ => None,
        }
    }
}

impl Anchor {
    const fn original_top(&self) -> f32 {
        match self {
            Self::Sequence { top, .. } | Self::Text { top, .. } => *top,
        }
    }
}

impl TextRenderer {
    fn new(messages: Vec<TranscriptMessage>) -> Self {
        let view = gtk::TextView::new();
        view.add_css_class("transcript-text-view");
        view.set_editable(false);
        view.set_cursor_visible(false);
        view.set_wrap_mode(gtk::WrapMode::WordChar);
        view.set_left_margin(12);
        view.set_right_margin(12);
        view.set_top_margin(12);
        view.set_bottom_margin(12);
        let buffer = view.buffer();
        let role_tag = buffer
            .create_tag(Some("benchmark-role"), &[("weight", &700_i32)])
            .expect("role tag name is unique");
        let code_tag = buffer
            .create_tag(Some("benchmark-code"), &[("family", &"monospace")])
            .expect("code tag name is unique");
        let renderer = Self {
            view,
            role_tag,
            code_tag,
        };
        renderer.insert_messages(messages, false);
        renderer
    }

    fn insert_messages(&self, messages: Vec<TranscriptMessage>, at_start: bool) {
        let buffer = self.view.buffer();
        let mut iter = if at_start {
            buffer.start_iter()
        } else {
            buffer.end_iter()
        };
        for message in messages {
            buffer.insert_with_tags(
                &mut iter,
                &format!("{}\n", role_label(message.role)),
                &[&self.role_tag],
            );
            for block in message.blocks {
                match block.kind {
                    TranscriptBlockKind::Text { text } => {
                        buffer.insert(&mut iter, &text);
                        buffer.insert(&mut iter, "\n");
                    }
                    TranscriptBlockKind::Code { language, text } => {
                        if let Some(language) = language {
                            buffer.insert(&mut iter, &language);
                            buffer.insert(&mut iter, "\n");
                        }
                        buffer.insert_with_tags(&mut iter, &text, &[&self.code_tag]);
                        buffer.insert(&mut iter, "\n");
                    }
                    TranscriptBlockKind::ToolCall { title, status, .. } => {
                        self.insert_widget(&buffer, &mut iter, tool_call_widget(&title, &status));
                    }
                    TranscriptBlockKind::ToolResult { content, .. } => {
                        self.insert_widget(&buffer, &mut iter, tool_result_widget(&content));
                    }
                    TranscriptBlockKind::Image { alt, uri } => {
                        buffer.insert(&mut iter, alt.as_deref().unwrap_or(&uri));
                        buffer.insert(&mut iter, "\n");
                    }
                    TranscriptBlockKind::Resource { uri, title } => {
                        buffer.insert(&mut iter, title.as_deref().unwrap_or(&uri));
                        buffer.insert(&mut iter, "\n");
                    }
                    TranscriptBlockKind::Other { kind, .. } => {
                        buffer.insert(&mut iter, &kind);
                        buffer.insert(&mut iter, "\n");
                    }
                }
            }
            buffer.insert(&mut iter, "\n");
        }
    }

    fn insert_widget(
        &self,
        buffer: &gtk::TextBuffer,
        iter: &mut gtk::TextIter,
        widget: gtk::Widget,
    ) {
        let anchor = buffer.create_child_anchor(iter);
        self.view.add_child_at_anchor(&widget, &anchor);
        buffer.insert(iter, "\n");
    }

    fn visible_anchor(&self) -> Option<Anchor> {
        let (_, buffer_y) = self
            .view
            .window_to_buffer_coords(gtk::TextWindowType::Text, 0, 0);
        let iter = self
            .view
            .iter_at_location(self.view.left_margin(), buffer_y)?;
        let mark = self.view.buffer().create_mark(None, &iter, true);
        let top = self.iter_top(&iter);
        Some(Anchor::Text { mark, top })
    }

    fn mark_top(&self, mark: &gtk::TextMark) -> Option<f32> {
        let iter = self.view.buffer().iter_at_mark(mark);
        Some(self.iter_top(&iter))
    }

    fn iter_top(&self, iter: &gtk::TextIter) -> f32 {
        let rect = self.view.iter_location(iter);
        let (_, y) =
            self.view
                .buffer_to_window_coords(gtk::TextWindowType::Text, rect.x(), rect.y());
        y as f32
    }
}

fn tool_call_widget(title: &str, status: &str) -> gtk::Widget {
    let container = gtk::Box::new(gtk::Orientation::Vertical, 0);
    container.add_css_class("transcript-tool");
    container.set_hexpand(true);
    let title = selectable_label(title, None);
    let status = selectable_label(status, None);
    status.add_css_class("transcript-block-secondary");
    container.append(&title);
    container.append(&status);
    container.upcast()
}

fn tool_result_widget(content: &str) -> gtk::Widget {
    let expander = gtk::Expander::new(Some("Result"));
    expander.add_css_class("transcript-tool");
    expander.set_child(Some(&selectable_label(content, Some("monospace"))));
    expander.set_hexpand(true);
    expander.upcast()
}

fn selectable_label(text: &str, css_class: Option<&str>) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.set_hexpand(true);
    label.set_selectable(true);
    label.set_wrap(true);
    label.set_wrap_mode(gtk::pango::WrapMode::WordChar);
    label.set_xalign(0.0);
    if let Some(css_class) = css_class {
        label.add_css_class(css_class);
    }
    label
}

fn observed_message_factory(rows: BoundRows) -> gtk::SignalListItemFactory {
    let factory = message_renderer::message_factory();
    factory.connect_bind({
        let rows = rows.clone();
        move |_, object| {
            let list_item = object
                .downcast_ref::<gtk::ListItem>()
                .expect("factory receives GtkListItem");
            let item = list_item
                .item()
                .and_downcast::<glib::BoxedAnyObject>()
                .expect("message model contains boxed objects");
            let sequence = item.borrow::<TranscriptMessage>().sequence;
            if let Some(row) = list_item.child() {
                rows.bind(sequence, &row);
            }
        }
    });
    factory.connect_unbind(move |_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("factory receives GtkListItem");
        if let Some(row) = list_item.child() {
            rows.unbind(&row);
        }
    });
    factory
}

fn observed_block_factory(rows: BoundRows) -> gtk::SignalListItemFactory {
    let factory = message_renderer::render_chunk_factory();
    factory.connect_bind({
        let rows = rows.clone();
        move |_, object| {
            let list_item = object
                .downcast_ref::<gtk::ListItem>()
                .expect("factory receives GtkListItem");
            let item = list_item
                .item()
                .and_downcast::<glib::BoxedAnyObject>()
                .expect("block model contains boxed objects");
            let item = item.borrow::<message_renderer::TranscriptRenderItem>();
            if let Some(row) = list_item.child() {
                rows.unbind(&row);
                if item.starts_message() {
                    rows.bind(item.message_sequence, &row);
                }
            }
        }
    });
    factory.connect_unbind(move |_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("factory receives GtkListItem");
        if let Some(row) = list_item.child() {
            rows.unbind(&row);
        }
    });
    factory
}

fn build_content(
    renderer: Renderer,
    messages: Vec<TranscriptMessage>,
) -> (gtk::Widget, BenchContent, u32) {
    match renderer {
        Renderer::BlockList => {
            let rows = BoundRows::default();
            let store = gio::ListStore::new::<glib::BoxedAnyObject>();
            let items = message_renderer::render_items(messages);
            store.splice(0, 0, &items);
            let item_count = store.n_items();
            let selection = gtk::NoSelection::new(Some(store.clone()));
            let list =
                gtk::ListView::new(Some(selection), Some(observed_block_factory(rows.clone())));
            list.add_css_class("transcript-list");
            list.set_vexpand(true);
            (
                list.upcast(),
                BenchContent::List {
                    store,
                    rows,
                    projection: ListProjection::Blocks,
                },
                item_count,
            )
        }
        Renderer::MessageList => {
            let rows = BoundRows::default();
            let store = gio::ListStore::new::<glib::BoxedAnyObject>();
            let items = messages
                .into_iter()
                .map(glib::BoxedAnyObject::new)
                .collect::<Vec<_>>();
            store.splice(0, 0, &items);
            let item_count = store.n_items();
            let selection = gtk::NoSelection::new(Some(store.clone()));
            let list = gtk::ListView::new(
                Some(selection),
                Some(observed_message_factory(rows.clone())),
            );
            list.add_css_class("transcript-list");
            list.set_vexpand(true);
            list.set_vscroll_policy(gtk::ScrollablePolicy::Natural);
            (
                list.upcast(),
                BenchContent::List {
                    store,
                    rows,
                    projection: ListProjection::Messages,
                },
                item_count,
            )
        }
        Renderer::ListBox => {
            let rows = BoundRows::default();
            let list = gtk::ListBox::new();
            list.add_css_class("transcript-list");
            list.set_selection_mode(gtk::SelectionMode::None);
            let item_count = messages.len() as u32;
            for message in messages {
                let row = message_renderer::materialized_message_row(&message);
                rows.bind(message.sequence, row.upcast_ref());
                list.append(&row);
            }
            (
                list.clone().upcast(),
                BenchContent::ListBox { list, rows },
                item_count,
            )
        }
        Renderer::Box => {
            let rows = BoundRows::default();
            let container = gtk::Box::new(gtk::Orientation::Vertical, 0);
            let item_count = messages.len() as u32;
            for message in messages {
                let row = message_renderer::materialized_message_row(&message);
                rows.bind(message.sequence, row.upcast_ref());
                container.append(&row);
            }
            let compensate = Rc::new(Cell::new(false));
            let previous_upper = Rc::new(Cell::new(0.0));
            (
                container.clone().upcast(),
                BenchContent::Box {
                    container,
                    rows,
                    compensate,
                    previous_upper,
                },
                item_count,
            )
        }
        Renderer::TextView => {
            let item_count = messages.len() as u32;
            let renderer = TextRenderer::new(messages);
            (
                renderer.view.clone().upcast(),
                BenchContent::Text(renderer),
                item_count,
            )
        }
    }
}

fn build_benchmark(application: &adw::Application, config: Config) {
    let (messages, prepend_messages) = match benchmark_messages(&config) {
        Ok(messages) => messages,
        Err(error) => {
            eprintln!("could not load benchmark messages: {error}");
            application.quit();
            return;
        }
    };
    let message_count = messages.len() as u32;
    let prepend_count = prepend_messages.len() as u32;

    let build_started = Instant::now();
    let (child, content, item_count) = build_content(config.renderer, messages);
    let build_time = build_started.elapsed();

    let viewport = gtk::ScrolledWindow::new();
    viewport.set_hscrollbar_policy(gtk::PolicyType::Never);
    viewport.set_vexpand(true);
    viewport.set_child(Some(&child));
    content.install_adjustment_handler(&viewport.vadjustment());

    let window = adw::ApplicationWindow::builder()
        .application(application)
        .title(format!(
            "Transcript render benchmark · {}",
            config.renderer.name()
        ))
        .default_width(900)
        .default_height(720)
        .content(&viewport)
        .build();
    window.present();

    let runner = BenchmarkRunner::new(
        application,
        config.clone(),
        viewport.clone(),
        content,
        BenchmarkFixture {
            prepend_messages,
            message_count,
            prepend_count,
            item_count,
            build_time,
        },
    );
    let runner = Rc::new(RefCell::new(runner));
    viewport.add_tick_callback(move |_, _| runner.borrow_mut().tick());
}

fn benchmark_messages(
    config: &Config,
) -> Result<(Vec<TranscriptMessage>, Vec<TranscriptMessage>), String> {
    let (Some(provider), Some(session)) = (&config.provider, &config.session) else {
        let messages = (0..config.messages)
            .map(|sequence| synthetic_message(i64::from(sequence)))
            .collect::<Vec<_>>();
        let prepend_messages = (1..=config.prepend_messages)
            .rev()
            .map(|offset| synthetic_message(-i64::from(offset)))
            .collect::<Vec<_>>();
        return Ok((repeat_messages(&messages, config.copies)?, prepend_messages));
    };

    let store = TranscriptStore::open_default().map_err(|error| error.to_string())?;
    let key = TranscriptSessionKey::new(provider, session);
    let messages = store
        .newest_messages(&key, config.messages as usize)
        .map_err(|error| error.to_string())?;
    let prepend_messages = if let Some(first) = messages.first() {
        store
            .messages_before(&key, first.sequence, config.prepend_messages as usize)
            .map_err(|error| error.to_string())?
    } else {
        Vec::new()
    };
    Ok((repeat_messages(&messages, config.copies)?, prepend_messages))
}

fn repeat_messages(
    messages: &[TranscriptMessage],
    copies: u32,
) -> Result<Vec<TranscriptMessage>, String> {
    let capacity = messages
        .len()
        .checked_mul(copies as usize)
        .ok_or_else(|| "repeated fixture is too large".to_owned())?;
    let mut repeated = Vec::with_capacity(capacity);
    for copy in 0..copies {
        for message in messages {
            let mut message = message.clone();
            message.id = format!("copy-{copy}:{}", message.id);
            message.sequence = i64::try_from(repeated.len())
                .map_err(|_| "repeated fixture has too many messages".to_owned())?;
            repeated.push(message);
        }
    }
    Ok(repeated)
}

enum Phase {
    InitialSettle {
        frames: u32,
        stable_frames: u32,
        last_upper: f64,
    },
    Warmup {
        remaining: u32,
        direction: f64,
        last_target: f64,
    },
    Measure {
        remaining: u32,
        direction: f64,
        last_target: f64,
    },
    PrependSettle {
        frames: u32,
        stable_frames: u32,
        last_upper: f64,
        settle_started: Instant,
        mutation_time: Duration,
        anchor: Option<Anchor>,
    },
    Finished,
}

struct BenchmarkRunner {
    application: adw::Application,
    config: Config,
    viewport: gtk::ScrolledWindow,
    content: BenchContent,
    prepend_messages: Option<Vec<TranscriptMessage>>,
    message_count: u32,
    prepend_count: u32,
    item_count: u32,
    build_time: Duration,
    presented_at: Instant,
    ready_time: Duration,
    phase: Phase,
    last_tick: Option<Instant>,
    last_measured_upper: f64,
    samples: Vec<Duration>,
    upper_changes: u32,
    maximum_upper_delta: f64,
    maximum_value_correction: f64,
}

struct BenchmarkFixture {
    prepend_messages: Vec<TranscriptMessage>,
    message_count: u32,
    prepend_count: u32,
    item_count: u32,
    build_time: Duration,
}

impl BenchmarkRunner {
    fn new(
        application: &adw::Application,
        config: Config,
        viewport: gtk::ScrolledWindow,
        content: BenchContent,
        fixture: BenchmarkFixture,
    ) -> Self {
        let upper = viewport.vadjustment().upper();
        let sample_capacity = config.frames as usize;
        Self {
            application: application.clone(),
            config,
            viewport,
            content,
            prepend_messages: Some(fixture.prepend_messages),
            message_count: fixture.message_count,
            prepend_count: fixture.prepend_count,
            item_count: fixture.item_count,
            build_time: fixture.build_time,
            presented_at: Instant::now(),
            ready_time: Duration::ZERO,
            phase: Phase::InitialSettle {
                frames: 0,
                stable_frames: 0,
                last_upper: upper,
            },
            last_tick: None,
            last_measured_upper: upper,
            samples: Vec::with_capacity(sample_capacity),
            upper_changes: 0,
            maximum_upper_delta: 0.0,
            maximum_value_correction: 0.0,
        }
    }

    fn tick(&mut self) -> glib::ControlFlow {
        let now = Instant::now();
        let adjustment = self.viewport.vadjustment();
        let phase = std::mem::replace(&mut self.phase, Phase::Finished);
        self.phase = match phase {
            Phase::InitialSettle {
                mut frames,
                mut stable_frames,
                last_upper,
            } => {
                frames += 1;
                let upper = adjustment.upper();
                stable_frames = if (upper - last_upper).abs() < 0.5 {
                    stable_frames + 1
                } else {
                    0
                };
                if (frames >= MIN_INITIAL_FRAMES && stable_frames >= SETTLE_FRAMES)
                    || frames >= MAX_SETTLE_FRAMES
                {
                    self.ready_time = self.presented_at.elapsed();
                    let target = scroll_midpoint(&adjustment);
                    adjustment.set_value(target);
                    Phase::Warmup {
                        remaining: WARMUP_FRAMES,
                        direction: 1.0,
                        last_target: target,
                    }
                } else {
                    Phase::InitialSettle {
                        frames,
                        stable_frames,
                        last_upper: upper,
                    }
                }
            }
            Phase::Warmup {
                remaining,
                mut direction,
                last_target,
            } => {
                let target = drive_scroll(
                    &adjustment,
                    last_target,
                    &mut direction,
                    self.config.pixels_per_frame,
                );
                if remaining <= 1 {
                    self.last_tick = Some(now);
                    self.last_measured_upper = adjustment.upper();
                    Phase::Measure {
                        remaining: self.config.frames,
                        direction,
                        last_target: target,
                    }
                } else {
                    Phase::Warmup {
                        remaining: remaining - 1,
                        direction,
                        last_target: target,
                    }
                }
            }
            Phase::Measure {
                remaining,
                mut direction,
                last_target,
            } => {
                if let Some(previous) = self.last_tick.replace(now) {
                    self.samples.push(now.duration_since(previous));
                }
                let upper = adjustment.upper();
                let upper_delta = (upper - self.last_measured_upper).abs();
                if upper_delta >= 0.5 {
                    self.upper_changes += 1;
                    self.maximum_upper_delta = self.maximum_upper_delta.max(upper_delta);
                }
                self.last_measured_upper = upper;
                self.maximum_value_correction = self
                    .maximum_value_correction
                    .max((adjustment.value() - last_target).abs());

                if remaining <= 1 {
                    let anchor = self.content.visible_anchor(&self.viewport);
                    self.content.enable_anchor_compensation();
                    let mutation_started = Instant::now();
                    self.content.prepend(
                        self.prepend_messages
                            .take()
                            .expect("prepend messages are used once"),
                    );
                    let mutation_time = mutation_started.elapsed();
                    Phase::PrependSettle {
                        frames: 0,
                        stable_frames: 0,
                        last_upper: upper,
                        settle_started: Instant::now(),
                        mutation_time,
                        anchor,
                    }
                } else {
                    let target = drive_scroll(
                        &adjustment,
                        last_target,
                        &mut direction,
                        self.config.pixels_per_frame,
                    );
                    Phase::Measure {
                        remaining: remaining - 1,
                        direction,
                        last_target: target,
                    }
                }
            }
            Phase::PrependSettle {
                mut frames,
                mut stable_frames,
                last_upper,
                settle_started,
                mutation_time,
                anchor,
            } => {
                frames += 1;
                let upper = adjustment.upper();
                stable_frames = if (upper - last_upper).abs() < 0.5 {
                    stable_frames + 1
                } else {
                    0
                };
                if (frames >= SETTLE_FRAMES && stable_frames >= SETTLE_FRAMES)
                    || frames >= MAX_SETTLE_FRAMES
                {
                    let settle_time = settle_started.elapsed();
                    let anchor_drift = anchor.as_ref().and_then(|anchor| {
                        self.content
                            .anchor_top(anchor, &self.viewport)
                            .map(|top| (top - anchor.original_top()).abs())
                    });
                    self.print_results(mutation_time, settle_time, anchor_drift);
                    self.application.quit();
                    return glib::ControlFlow::Break;
                }
                Phase::PrependSettle {
                    frames,
                    stable_frames,
                    last_upper: upper,
                    settle_started,
                    mutation_time,
                    anchor,
                }
            }
            Phase::Finished => Phase::Finished,
        };
        glib::ControlFlow::Continue
    }

    fn print_results(
        &self,
        prepend_mutation_time: Duration,
        prepend_settle_time: Duration,
        anchor_drift: Option<f32>,
    ) {
        let mut milliseconds = self
            .samples
            .iter()
            .map(|sample| sample.as_secs_f64() * 1_000.0)
            .collect::<Vec<_>>();
        milliseconds.sort_by(f64::total_cmp);
        let percentile = |fraction: f64| {
            let index = ((milliseconds.len().saturating_sub(1)) as f64 * fraction).round() as usize;
            milliseconds.get(index).copied().unwrap_or_default()
        };
        let over_25 = milliseconds.iter().filter(|sample| **sample > 25.0).count();
        let over_50 = milliseconds.iter().filter(|sample| **sample > 50.0).count();
        println!(
            "renderer={} fixture={} copies={} messages={} model_items={} frames={} pixels_per_frame={:.0} build_ms={:.2} ready_ms={:.2} p50_ms={:.2} p95_ms={:.2} p99_ms={:.2} max_ms={:.2} over_25ms={} over_50ms={} upper_changes={} max_upper_delta_px={:.2} max_value_correction_px={:.2} prepend_messages={} prepend_mutation_ms={:.2} prepend_settle_ms={:.2} anchor_drift_px={} rss_mib={} peak_rss_mib={}",
            self.config.renderer.name(),
            if self.config.session.is_some() {
                "cached"
            } else {
                "synthetic"
            },
            self.config.copies,
            self.message_count,
            self.item_count,
            milliseconds.len(),
            self.config.pixels_per_frame,
            self.build_time.as_secs_f64() * 1_000.0,
            self.ready_time.as_secs_f64() * 1_000.0,
            percentile(0.50),
            percentile(0.95),
            percentile(0.99),
            milliseconds.last().copied().unwrap_or_default(),
            over_25,
            over_50,
            self.upper_changes,
            self.maximum_upper_delta,
            self.maximum_value_correction,
            self.prepend_count,
            prepend_mutation_time.as_secs_f64() * 1_000.0,
            prepend_settle_time.as_secs_f64() * 1_000.0,
            anchor_drift
                .map(|drift| format!("{drift:.3}"))
                .unwrap_or_else(|| "unavailable".into()),
            process_memory_mib("VmRSS"),
            process_memory_mib("VmHWM"),
        );
    }
}

fn process_memory_mib(field: &str) -> String {
    let Ok(status) = std::fs::read_to_string("/proc/self/status") else {
        return "unavailable".into();
    };
    status
        .lines()
        .find_map(|line| {
            let value = line.strip_prefix(field)?.trim_start().strip_prefix(':')?;
            let kib = value.split_whitespace().next()?.parse::<f64>().ok()?;
            Some(format!("{:.1}", kib / 1024.0))
        })
        .unwrap_or_else(|| "unavailable".into())
}

fn scroll_midpoint(adjustment: &gtk::Adjustment) -> f64 {
    (adjustment.upper() - adjustment.page_size()).max(0.0) * 0.5
}

fn drive_scroll(
    adjustment: &gtk::Adjustment,
    last_target: f64,
    direction: &mut f64,
    pixels_per_frame: f64,
) -> f64 {
    let scroll_range = (adjustment.upper() - adjustment.page_size()).max(0.0);
    let lower = scroll_range * 0.2;
    let upper = scroll_range * 0.8;
    let mut target = last_target + *direction * pixels_per_frame;
    if target >= upper {
        target = upper;
        *direction = -1.0;
    } else if target <= lower {
        target = lower;
        *direction = 1.0;
    }
    adjustment.set_value(target);
    target
}

fn synthetic_message(sequence: i64) -> TranscriptMessage {
    let role = if sequence.rem_euclid(5) == 0 {
        TranscriptRole::User
    } else {
        TranscriptRole::Agent
    };
    let mut message = TranscriptMessage::new(
        format!("message-{sequence}"),
        sequence,
        role,
        TranscriptMessageState::Complete,
    );
    let kinds = match sequence.rem_euclid(4) {
        0 => vec![text_block(sequence, 5)],
        1 => vec![
            text_block(sequence, 2),
            text_block(sequence, 4),
            tool_call(sequence, 0),
            tool_call(sequence, 1),
            code_block(sequence, 12),
            tool_result(sequence, 0),
        ],
        2 => vec![
            text_block(sequence, 3),
            tool_call(sequence, 0),
            code_block(sequence, 20),
            tool_result(sequence, 0),
            code_block(sequence, 8),
            text_block(sequence, 2),
        ],
        _ => vec![text_block(sequence, 16)],
    };
    message.blocks = kinds
        .into_iter()
        .enumerate()
        .map(|(block_sequence, kind)| TranscriptBlock {
            sequence: block_sequence as i64,
            kind,
        })
        .collect();
    message
}

fn text_block(sequence: i64, lines: usize) -> TranscriptBlockKind {
    let line = format!(
        "Synthetic assistant text for message {sequence}; it wraps and exercises selectable Pango layout."
    );
    TranscriptBlockKind::Text {
        text: std::iter::repeat_n(line, lines)
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

fn code_block(sequence: i64, lines: usize) -> TranscriptBlockKind {
    TranscriptBlockKind::Code {
        language: Some("rust".into()),
        text: (0..lines)
            .map(|line| format!("let value_{line} = process({sequence}, {line});"))
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

fn tool_call(sequence: i64, index: u32) -> TranscriptBlockKind {
    TranscriptBlockKind::ToolCall {
        tool_call_id: format!("tool-{sequence}-{index}"),
        title: format!("Run tool {index} for message {sequence}"),
        status: "completed".into(),
        payload_json: None,
    }
}

fn tool_result(sequence: i64, index: u32) -> TranscriptBlockKind {
    TranscriptBlockKind::ToolResult {
        tool_call_id: format!("tool-{sequence}-{index}"),
        content: format!(
            "Tool result for message {sequence}\n{}",
            "result\n".repeat(24)
        ),
    }
}

const fn role_label(role: TranscriptRole) -> &'static str {
    match role {
        TranscriptRole::User => "You",
        TranscriptRole::Agent => "Agent",
        TranscriptRole::Thought => "Thought",
        TranscriptRole::System => "System",
        TranscriptRole::Tool => "Tool",
    }
}
