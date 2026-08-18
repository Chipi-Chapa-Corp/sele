use adw::prelude::*;

use crate::components::build_workspace;

const DEFAULT_WIDTH: i32 = 1100;
const DEFAULT_HEIGHT: i32 = 720;

pub fn build(application: &adw::Application) {
    let window = adw::ApplicationWindow::builder()
        .application(application)
        .default_width(DEFAULT_WIDTH)
        .default_height(DEFAULT_HEIGHT)
        .resizable(true)
        .title("Sele")
        .build();

    window.set_content(Some(&build_workspace()));
    window.present();
}
