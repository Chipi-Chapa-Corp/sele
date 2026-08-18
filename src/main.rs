mod components;
mod theme;
mod transcript_loader;
mod window;

use adw::prelude::*;

const APPLICATION_ID: &str = "dev.sele.Sele";

fn main() -> gtk::glib::ExitCode {
    let application = adw::Application::builder()
        .application_id(APPLICATION_ID)
        .build();

    application.connect_startup(|_| {
        theme::load_styles();
    });
    application.connect_activate(window::build);

    application.run()
}
