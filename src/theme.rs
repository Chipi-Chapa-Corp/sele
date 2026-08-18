use gtk::gdk;

use crate::components;

const GLOBAL_STYLE: &str = include_str!("../assets/style.css");

pub fn load_styles() {
    let mut stylesheet = String::from(GLOBAL_STYLE);
    for component_style in components::STYLES {
        stylesheet.push('\n');
        stylesheet.push_str(component_style);
    }

    let provider = gtk::CssProvider::new();
    provider.load_from_string(&stylesheet);

    let display = gdk::Display::default().expect("a display is required to run Sele");
    gtk::style_context_add_provider_for_display(
        &display,
        &provider,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
}
