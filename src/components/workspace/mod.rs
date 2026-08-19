use std::cell::RefCell;
use std::rc::Rc;

use async_channel::Receiver;
use gtk::prelude::*;
use sele_agent::{DiscoveryEvent, start_builtin_runtime};

use super::button::build_button;
use super::{ChatSidebar, ChatView};

pub(super) const STYLE: &str = include_str!("style.css");

pub fn build_workspace() -> gtk::Paned {
    let (agent_runtime, discovery) = start_builtin_runtime();
    let transcript = ChatView::new(agent_runtime);
    let chats = ChatSidebar::new(transcript.clone());

    let chat_list_scroll = gtk::ScrolledWindow::new();
    chat_list_scroll.set_hscrollbar_policy(gtk::PolicyType::Never);
    chat_list_scroll.set_min_content_width(220);
    chat_list_scroll.set_vexpand(true);
    chat_list_scroll.set_child(Some(chats.widget()));

    let chat_list = workspace_pane("chat-list-pane", 220);
    let (chat_list_header, chat_search_bar, chat_search_entry) = chat_list_header();
    chat_search_bar.set_key_capture_widget(Some(chats.widget()));
    chats.bind_search_entry(&chat_search_entry);
    chat_list.append(&chat_list_header);
    chat_list.append(&chat_search_bar);
    chat_list.append(&chat_list_scroll);
    chat_list.append(chats.status_widget());

    let chat_view = workspace_pane("chat-view-pane", 320);
    chat_view.append(&chat_drag_strip());
    chat_view.append(transcript.widget());

    let sidebar = workspace_pane("sidebar-pane", 240);
    sidebar.append(&side_header("Sidebar", gtk::PackType::End));

    load_chat_list(chats, discovery);

    let content_and_sidebar = gtk::Paned::new(gtk::Orientation::Horizontal);
    content_and_sidebar.add_css_class("workspace-paned");
    content_and_sidebar.set_wide_handle(true);
    content_and_sidebar.set_start_child(Some(&chat_view));
    content_and_sidebar.set_end_child(Some(&sidebar));
    content_and_sidebar.set_position(560);
    content_and_sidebar.set_resize_start_child(true);
    content_and_sidebar.set_resize_end_child(false);
    content_and_sidebar.set_shrink_start_child(false);
    content_and_sidebar.set_shrink_end_child(false);

    let workspace = gtk::Paned::new(gtk::Orientation::Horizontal);
    workspace.add_css_class("workspace-paned");
    workspace.set_wide_handle(true);
    workspace.set_start_child(Some(&chat_list));
    workspace.set_end_child(Some(&content_and_sidebar));
    workspace.set_position(280);
    workspace.set_resize_start_child(false);
    workspace.set_resize_end_child(true);
    workspace.set_shrink_start_child(false);
    workspace.set_shrink_end_child(false);
    workspace
}

fn workspace_pane(css_class: &str, minimum_width: i32) -> gtk::Box {
    let pane = gtk::Box::new(gtk::Orientation::Vertical, 0);
    pane.add_css_class("workspace-pane");
    pane.add_css_class(css_class);
    pane.set_hexpand(true);
    pane.set_vexpand(true);
    pane.set_size_request(minimum_width, -1);
    pane
}

fn side_header(title: &str, controls_side: gtk::PackType) -> adw::HeaderBar {
    let header = adw::HeaderBar::builder()
        .show_start_title_buttons(controls_side == gtk::PackType::Start)
        .show_end_title_buttons(controls_side == gtk::PackType::End)
        .build();
    header.add_css_class("flat");
    header.set_title_widget(Some(&pane_title(title)));
    header
}

fn chat_list_header() -> (adw::HeaderBar, gtk::SearchBar, gtk::SearchEntry) {
    let header = side_header("Chats", gtk::PackType::Start);
    let settings = header_icon_button("applications-system-symbolic", "Settings");
    let new_chat = header_icon_button("chat-message-new-symbolic", "New Chat");
    let search = header_icon_button("system-search-symbolic", "Search");
    let search_entry = gtk::SearchEntry::new();
    search_entry.set_hexpand(true);
    search_entry.set_halign(gtk::Align::Fill);
    search_entry.set_placeholder_text(Some("Search chats"));
    let search_bar = gtk::SearchBar::new();
    search_bar.set_hexpand(true);
    search_bar.set_halign(gtk::Align::Fill);
    search_bar.set_child(Some(&search_entry));
    search_bar.connect_entry(&search_entry);

    let search_bar_for_button = search_bar.clone();
    let search_entry_for_button = search_entry.clone();
    search.connect_clicked(move |_| {
        let enabled = !search_bar_for_button.is_search_mode();
        search_bar_for_button.set_search_mode(enabled);
        if enabled {
            search_entry_for_button.grab_focus();
        }
    });

    let search_entry_for_bar = search_entry.clone();
    search_bar.connect_search_mode_enabled_notify(move |bar| {
        if !bar.is_search_mode() {
            search_entry_for_bar.set_text("");
        }
    });

    header.pack_start(&settings);
    header.pack_end(&new_chat);
    header.pack_end(&search);
    (header, search_bar, search_entry)
}

fn header_icon_button(icon_name: &str, tooltip: &str) -> gtk::Button {
    let button = build_button(Some(icon_name), None);
    button.set_tooltip_text(Some(tooltip));
    button
}

fn chat_drag_strip() -> gtk::WindowHandle {
    let handle = gtk::WindowHandle::new();
    handle.add_css_class("chat-drag-strip");
    handle
}

fn pane_title(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("heading");
    label.set_halign(gtk::Align::Start);
    label
}

fn load_chat_list(chat_sidebar: ChatSidebar, receiver: Receiver<DiscoveryEvent>) {
    let sessions = Rc::new(RefCell::new(Vec::new()));
    let failures = Rc::new(RefCell::new(Vec::new()));

    gtk::glib::MainContext::default().spawn_local(async move {
        while let Ok(event) = receiver.recv().await {
            match event {
                DiscoveryEvent::AgentLoaded {
                    agent: _,
                    sessions: discovered,
                } => {
                    sessions.borrow_mut().extend(discovered);
                    chat_sidebar.update(&sessions.borrow(), &failures.borrow(), true);
                }
                DiscoveryEvent::AgentFailed { agent, error } => {
                    failures
                        .borrow_mut()
                        .push(format!("{}: {error}", agent.name));
                }
                DiscoveryEvent::EngineFailed(error) => failures.borrow_mut().push(error),
                DiscoveryEvent::Finished => {
                    chat_sidebar.update(&sessions.borrow(), &failures.borrow(), false);
                    break;
                }
            }
        }
    });
}
