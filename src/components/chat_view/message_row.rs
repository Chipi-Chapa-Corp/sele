use std::collections::HashMap;

use gtk::glib;
use gtk::glib::prelude::*;
use gtk::prelude::*;
use sele_core::{TranscriptBlockKind, TranscriptMessage, TranscriptMessageState, TranscriptRole};

const LARGE_BLOCK_THRESHOLD: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum BlockViewKind {
    Text,
    LongText,
    Code,
    LongCode,
    ToolCall,
    ToolResult,
    Label,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)]
enum ChunkPosition {
    Only,
    First,
    Middle,
    Last,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub(crate) struct TranscriptRenderItem {
    // The benchmark imports this module independently and does not page by sequence.
    pub(crate) message_sequence: i64,
    role: TranscriptRole,
    state: TranscriptMessageState,
    position: ChunkPosition,
    block: Option<TranscriptBlockKind>,
}

impl TranscriptRenderItem {
    #[allow(dead_code)]
    pub(crate) const fn starts_message(&self) -> bool {
        matches!(self.position, ChunkPosition::Only | ChunkPosition::First)
    }

    #[allow(dead_code)]
    pub(crate) const fn ends_message(&self) -> bool {
        matches!(self.position, ChunkPosition::Only | ChunkPosition::Last)
    }
}

#[allow(dead_code)]
pub(crate) fn render_items(messages: Vec<TranscriptMessage>) -> Vec<glib::BoxedAnyObject> {
    messages
        .into_iter()
        .flat_map(|message| {
            let block_count = message.blocks.len();
            if block_count == 0 {
                return vec![glib::BoxedAnyObject::new(TranscriptRenderItem {
                    message_sequence: message.sequence,
                    role: message.role,
                    state: message.state,
                    position: ChunkPosition::Only,
                    block: None,
                })];
            }

            message
                .blocks
                .into_iter()
                .enumerate()
                .map(|(index, block)| {
                    let position = match (index, block_count) {
                        (0, 1) => ChunkPosition::Only,
                        (0, _) => ChunkPosition::First,
                        (index, count) if index + 1 == count => ChunkPosition::Last,
                        _ => ChunkPosition::Middle,
                    };
                    glib::BoxedAnyObject::new(TranscriptRenderItem {
                        message_sequence: message.sequence,
                        role: message.role,
                        state: message.state,
                        position,
                        block: Some(block.kind),
                    })
                })
                .collect()
        })
        .collect()
}

#[allow(dead_code)]
pub(crate) fn render_chunk_factory() -> gtk::SignalListItemFactory {
    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, object| setup_row(object));
    factory.connect_bind(|_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("render chunk factory receives GtkListItem");
        let item = list_item
            .item()
            .and_downcast::<glib::BoxedAnyObject>()
            .expect("transcript model contains render chunks");
        let item = item.borrow::<TranscriptRenderItem>();
        let row = list_item
            .child()
            .and_downcast::<gtk::Box>()
            .expect("render chunk row is a GtkBox");
        bind_render_item(&row, &item);
    });
    factory
}

#[allow(dead_code)]
pub(crate) fn message_factory() -> gtk::SignalListItemFactory {
    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, object| setup_row(object));
    factory.connect_bind(|_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("message factory receives GtkListItem");
        let item = list_item
            .item()
            .and_downcast::<glib::BoxedAnyObject>()
            .expect("transcript model contains messages");
        let message = item.borrow::<TranscriptMessage>();
        let row = list_item
            .child()
            .and_downcast::<gtk::Box>()
            .expect("message row is a GtkBox");
        bind_message(&row, &message);
    });
    factory
}

fn setup_row(object: &glib::Object) {
    let list_item = object
        .downcast_ref::<gtk::ListItem>()
        .expect("transcript factory receives GtkListItem");
    list_item.set_child(Some(&new_message_row()));
}

fn new_message_row() -> gtk::Box {
    let row = gtk::Box::new(gtk::Orientation::Vertical, 0);
    row.add_css_class("transcript-message");
    row.set_hexpand(true);

    let role = gtk::Label::new(None);
    role.add_css_class("transcript-role");
    role.set_halign(gtk::Align::Start);
    role.set_xalign(0.0);
    row.append(&role);

    let blocks = gtk::Box::new(gtk::Orientation::Vertical, 0);
    blocks.add_css_class("transcript-message-blocks");
    row.append(&blocks);
    row
}

/// Build a permanently materialized native message row.
#[allow(dead_code)]
pub(crate) fn materialized_message_row(message: &TranscriptMessage) -> gtk::Box {
    let row = new_message_row();
    bind_message(&row, message);
    row
}

/// Build a permanently materialized native widget for an embedded transcript block.
#[allow(dead_code)]
pub(crate) fn materialized_block_widget(block: &TranscriptBlockKind) -> gtk::Widget {
    let widget = create_block_view(kind_for_block(block));
    bind_block_view(&widget, block);
    widget
}

#[allow(dead_code)]
fn bind_render_item(row: &gtk::Box, item: &TranscriptRenderItem) {
    bind_row_style(row, item.role, item.state);
    for class in [
        "transcript-message-only",
        "transcript-message-first",
        "transcript-message-middle",
        "transcript-message-last",
    ] {
        row.remove_css_class(class);
    }
    row.add_css_class(match item.position {
        ChunkPosition::Only => "transcript-message-only",
        ChunkPosition::First => "transcript-message-first",
        ChunkPosition::Middle => "transcript-message-middle",
        ChunkPosition::Last => "transcript-message-last",
    });

    let role = role_widget(row);
    role.set_text(role_label(item.role));
    role.set_visible(matches!(
        item.position,
        ChunkPosition::Only | ChunkPosition::First
    ));
    bind_blocks(block_container(&role), item.block.iter());
}

#[allow(dead_code)]
fn bind_message(row: &gtk::Box, message: &TranscriptMessage) {
    bind_row_style(row, message.role, message.state);
    for class in [
        "transcript-message-first",
        "transcript-message-middle",
        "transcript-message-last",
    ] {
        row.remove_css_class(class);
    }
    row.add_css_class("transcript-message-only");

    let role = role_widget(row);
    role.set_text(role_label(message.role));
    role.set_visible(true);
    bind_blocks(
        block_container(&role),
        message.blocks.iter().map(|block| &block.kind),
    );
}

fn bind_row_style(row: &gtk::Box, role: TranscriptRole, state: TranscriptMessageState) {
    for class in [
        "transcript-message-user",
        "transcript-message-agent",
        "transcript-message-thought",
        "transcript-message-tool",
        "transcript-message-error",
    ] {
        row.remove_css_class(class);
    }
    row.add_css_class(role_css_class(role));
    if state == TranscriptMessageState::Error {
        row.add_css_class("transcript-message-error");
    }
}

fn role_widget(row: &gtk::Box) -> gtk::Label {
    row.first_child()
        .and_downcast::<gtk::Label>()
        .expect("transcript row starts with its role label")
}

fn block_container(role: &gtk::Label) -> gtk::Box {
    role.next_sibling()
        .and_downcast::<gtk::Box>()
        .expect("transcript role is followed by its block container")
}

fn bind_blocks<'a>(container: gtk::Box, blocks: impl IntoIterator<Item = &'a TranscriptBlockKind>) {
    let mut available = HashMap::<BlockViewKind, Vec<gtk::Widget>>::new();
    let mut child = container.first_child();
    while let Some(widget) = child {
        child = widget.next_sibling();
        let kind = block_view_kind(&widget);
        widget.set_visible(false);
        available.entry(kind).or_default().push(widget);
    }

    let mut previous = None::<gtk::Widget>;
    for block in blocks {
        let kind = kind_for_block(block);
        let widget = available
            .get_mut(&kind)
            .and_then(Vec::pop)
            .unwrap_or_else(|| {
                let widget = create_block_view(kind);
                container.append(&widget);
                widget
            });
        bind_block_view(&widget, block);
        container.reorder_child_after(&widget, previous.as_ref());
        widget.set_visible(true);
        previous = Some(widget);
    }
}

fn kind_for_block(block: &TranscriptBlockKind) -> BlockViewKind {
    match block {
        TranscriptBlockKind::Text { text } if text.len() > LARGE_BLOCK_THRESHOLD => {
            BlockViewKind::LongText
        }
        TranscriptBlockKind::Text { .. } => BlockViewKind::Text,
        TranscriptBlockKind::Code { text, .. } if text.len() > LARGE_BLOCK_THRESHOLD => {
            BlockViewKind::LongCode
        }
        TranscriptBlockKind::Code { .. } => BlockViewKind::Code,
        TranscriptBlockKind::ToolCall { .. } => BlockViewKind::ToolCall,
        TranscriptBlockKind::ToolResult { .. } => BlockViewKind::ToolResult,
        TranscriptBlockKind::Image { .. }
        | TranscriptBlockKind::Resource { .. }
        | TranscriptBlockKind::Other { .. } => BlockViewKind::Label,
    }
}

fn block_view_kind(widget: &gtk::Widget) -> BlockViewKind {
    for (class, kind) in [
        ("render-block-text", BlockViewKind::Text),
        ("render-block-long-text", BlockViewKind::LongText),
        ("render-block-code", BlockViewKind::Code),
        ("render-block-long-code", BlockViewKind::LongCode),
        ("render-block-tool-call", BlockViewKind::ToolCall),
        ("render-block-tool-result", BlockViewKind::ToolResult),
        ("render-block-label", BlockViewKind::Label),
    ] {
        if widget.has_css_class(class) {
            return kind;
        }
    }
    unreachable!("message block pool contains a known block view")
}

fn create_block_view(kind: BlockViewKind) -> gtk::Widget {
    match kind {
        BlockViewKind::Text => {
            let label = selectable_label("", None);
            label.add_css_class("render-block-text");
            label.upcast()
        }
        BlockViewKind::LongText => reusable_expander("render-block-long-text", None, None).upcast(),
        BlockViewKind::Code => {
            let container = gtk::Box::new(gtk::Orientation::Vertical, 0);
            container.add_css_class("render-block-code");
            container.add_css_class("transcript-code");
            let language = gtk::Label::new(None);
            language.add_css_class("transcript-block-secondary");
            language.set_xalign(0.0);
            container.append(&language);
            container.append(&selectable_label("", Some("monospace")));
            container.upcast()
        }
        BlockViewKind::LongCode => reusable_expander(
            "render-block-long-code",
            Some("monospace"),
            Some("transcript-code"),
        )
        .upcast(),
        BlockViewKind::ToolCall => {
            let container = gtk::Box::new(gtk::Orientation::Vertical, 0);
            container.add_css_class("render-block-tool-call");
            container.add_css_class("transcript-tool");
            container.append(&selectable_label("", None));
            let status = gtk::Label::new(None);
            status.add_css_class("transcript-block-secondary");
            status.set_xalign(0.0);
            container.append(&status);
            container.upcast()
        }
        BlockViewKind::ToolResult => reusable_expander(
            "render-block-tool-result",
            Some("monospace"),
            Some("transcript-tool"),
        )
        .upcast(),
        BlockViewKind::Label => {
            let label = selectable_label("", None);
            label.add_css_class("render-block-label");
            label.upcast()
        }
    }
}

fn bind_block_view(widget: &gtk::Widget, block: &TranscriptBlockKind) {
    match block {
        TranscriptBlockKind::Text { text } if text.len() > LARGE_BLOCK_THRESHOLD => {
            bind_expander(widget, "Long message", text)
        }
        TranscriptBlockKind::Text { text } => widget
            .downcast_ref::<gtk::Label>()
            .expect("text block uses a label")
            .set_text(text),
        TranscriptBlockKind::Code { language, text } if text.len() > LARGE_BLOCK_THRESHOLD => {
            bind_expander(
                widget,
                language.as_deref().unwrap_or("Large code block"),
                text,
            );
        }
        TranscriptBlockKind::Code { language, text } => {
            let container = widget
                .downcast_ref::<gtk::Box>()
                .expect("code block uses a box");
            let language_label = container
                .first_child()
                .and_downcast::<gtk::Label>()
                .expect("code block starts with its language label");
            language_label.set_text(language.as_deref().unwrap_or_default());
            language_label.set_visible(language.is_some());
            container
                .last_child()
                .and_downcast::<gtk::Label>()
                .expect("code block ends with its content label")
                .set_text(text);
        }
        TranscriptBlockKind::ToolCall { title, status, .. } => {
            let container = widget
                .downcast_ref::<gtk::Box>()
                .expect("tool call uses a box");
            container
                .first_child()
                .and_downcast::<gtk::Label>()
                .expect("tool call starts with its title")
                .set_text(title);
            container
                .last_child()
                .and_downcast::<gtk::Label>()
                .expect("tool call ends with its status")
                .set_text(status);
        }
        TranscriptBlockKind::ToolResult { content, .. } => {
            bind_expander(widget, "Result", content);
        }
        TranscriptBlockKind::Image { alt, uri } => {
            bind_generic_label(widget, alt.as_deref().unwrap_or(uri), false);
        }
        TranscriptBlockKind::Resource { uri, title } => {
            bind_generic_label(widget, title.as_deref().unwrap_or(uri), false);
        }
        TranscriptBlockKind::Other { kind, .. } => bind_generic_label(widget, kind, true),
    }
}

fn reusable_expander(
    view_class: &str,
    content_css_class: Option<&str>,
    expander_css_class: Option<&str>,
) -> gtk::Expander {
    let expander = gtk::Expander::new(None);
    expander.add_css_class(view_class);
    expander.add_css_class("transcript-block-expander");
    if let Some(css_class) = expander_css_class {
        expander.add_css_class(css_class);
    }
    expander.set_child(Some(&selectable_label("", content_css_class)));
    expander
}

fn bind_expander(widget: &gtk::Widget, title: &str, text: &str) {
    let expander = widget
        .downcast_ref::<gtk::Expander>()
        .expect("large block uses an expander");
    expander.set_expanded(false);
    expander.set_label(Some(&format!("{title} · {}", format_size(text.len()))));
    expander
        .child()
        .and_downcast::<gtk::Label>()
        .expect("large block expander contains its text label")
        .set_text(text);
}

fn bind_generic_label(widget: &gtk::Widget, text: &str, secondary: bool) {
    let label = widget
        .downcast_ref::<gtk::Label>()
        .expect("generic block uses a label");
    if secondary {
        label.add_css_class("transcript-block-secondary");
    } else {
        label.remove_css_class("transcript-block-secondary");
    }
    label.set_text(text);
}

fn format_size(bytes: usize) -> String {
    const KIB: f64 = 1024.0;
    if bytes < 1024 {
        format!("{bytes} B")
    } else {
        format!("{:.1} KiB", bytes as f64 / KIB)
    }
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

const fn role_label(role: TranscriptRole) -> &'static str {
    match role {
        TranscriptRole::User => "You",
        TranscriptRole::Agent => "Agent",
        TranscriptRole::Thought => "Thought",
        TranscriptRole::System => "System",
        TranscriptRole::Tool => "Tool",
    }
}

const fn role_css_class(role: TranscriptRole) -> &'static str {
    match role {
        TranscriptRole::User => "transcript-message-user",
        TranscriptRole::Agent | TranscriptRole::System => "transcript-message-agent",
        TranscriptRole::Thought => "transcript-message-thought",
        TranscriptRole::Tool => "transcript-message-tool",
    }
}
