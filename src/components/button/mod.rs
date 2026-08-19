use gtk::prelude::*;

/// Builds a native button from an optional themed icon name and label.
pub(super) fn build_button(icon_name: Option<&str>, label: Option<&str>) -> gtk::Button {
    match (icon_name, label) {
        (Some(icon_name), Some(label)) => {
            let content = adw::ButtonContent::builder()
                .icon_name(icon_name)
                .label(label)
                .build();
            let button = gtk::Button::new();
            button.set_child(Some(&content));
            button
        }
        (Some(icon_name), None) => {
            let button = gtk::Button::from_icon_name(icon_name);
            button.add_css_class("image-button");
            button
        }
        (None, Some(label)) => gtk::Button::with_label(label),
        (None, None) => gtk::Button::new(),
    }
}
