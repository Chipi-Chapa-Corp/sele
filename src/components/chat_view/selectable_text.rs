use gtk::prelude::*;
use sele_core::{TranscriptBlockKind, TranscriptMessage};

pub(super) fn label(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.set_selectable(true);
    label.set_wrap(true);
    label.set_wrap_mode(gtk::pango::WrapMode::WordChar);
    label.set_xalign(0.0);
    suppress_selected_text_drag(&label);
    label
}

fn suppress_selected_text_drag(label: &gtk::Label) {
    let controllers = label.observe_controllers();
    for index in 0..controllers.n_items() {
        let Some(gesture) = controllers.item(index).and_downcast::<gtk::GestureDrag>() else {
            continue;
        };
        let label = label.clone();
        gesture.connect_drag_begin(move |gesture, x, y| {
            let Some((start, end)) = label.selection_bounds() else {
                return;
            };
            let offset = text_offset_at(&label, x, y);
            if start <= offset && offset <= end {
                gesture.set_state(gtk::EventSequenceState::Denied);
            }
        });
    }
}

fn text_offset_at(label: &gtk::Label, x: f64, y: f64) -> i32 {
    let layout = label.layout();
    let (layout_x, layout_y) = label.layout_offsets();
    let (_, byte_offset, trailing) = layout.xy_to_index(
        ((x - f64::from(layout_x)) * f64::from(gtk::pango::SCALE)) as i32,
        ((y - f64::from(layout_y)) * f64::from(gtk::pango::SCALE)) as i32,
    );
    let text = label.text();
    let byte_offset = usize::try_from(byte_offset)
        .unwrap_or_default()
        .min(text.len());
    let byte_offset = text
        .char_indices()
        .map(|(offset, _)| offset)
        .take_while(|offset| *offset <= byte_offset)
        .last()
        .unwrap_or_default();
    i32::try_from(text[..byte_offset].chars().count())
        .unwrap_or(i32::MAX)
        .saturating_add(trailing)
        .clamp(0, i32::try_from(text.chars().count()).unwrap_or(i32::MAX))
}

pub(super) fn message_label(message: &TranscriptMessage) -> gtk::Label {
    let mut text = String::new();
    let mut monospace_ranges = Vec::new();

    for block in &message.blocks {
        let (block_text, monospace) = block_text(&block.kind);
        if block_text.trim().is_empty() {
            continue;
        }
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        let start = text.len();
        text.push_str(&block_text);
        if monospace {
            monospace_ranges.push((start, text.len()));
        }
    }

    let label = label(&text);
    if !monospace_ranges.is_empty() {
        let attributes = gtk::pango::AttrList::new();
        for (start, end) in monospace_ranges {
            let mut family = gtk::pango::AttrString::new_family("monospace");
            family.set_start_index(u32::try_from(start).unwrap_or(u32::MAX));
            family.set_end_index(u32::try_from(end).unwrap_or(u32::MAX));
            attributes.insert(family);
        }
        label.set_attributes(Some(&attributes));
    }
    label
}

fn block_text(block: &TranscriptBlockKind) -> (String, bool) {
    match block {
        TranscriptBlockKind::Text { text } => (text.clone(), false),
        TranscriptBlockKind::Code { language, text } => {
            let text = language
                .as_ref()
                .map_or_else(|| text.clone(), |language| format!("{language}\n{text}"));
            (text, true)
        }
        TranscriptBlockKind::Image { alt, uri } => {
            (alt.as_deref().unwrap_or(uri).to_owned(), false)
        }
        TranscriptBlockKind::Resource { uri, title } => {
            (title.as_deref().unwrap_or(uri).to_owned(), false)
        }
        TranscriptBlockKind::Other { kind, .. } => (kind.clone(), false),
        TranscriptBlockKind::ToolCall { title, .. } => (title.clone(), false),
        TranscriptBlockKind::ToolResult { content, .. } => (content.clone(), true),
    }
}
