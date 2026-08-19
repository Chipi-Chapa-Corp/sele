use std::cell::RefCell;
use std::rc::Rc;

use async_channel::Receiver;
use gtk::prelude::*;
use sele_agent::{DiscoveryEvent, start_builtin_runtime};

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
    chat_list.append(&side_header("Chats", gtk::PackType::Start));
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

fn side_header(title: &str, controls_side: gtk::PackType) -> gtk::WindowHandle {
    let handle = gtk::WindowHandle::new();
    handle.add_css_class("side-pane-header");

    let content = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    content.add_css_class("side-pane-header-content");
    let controls = gtk::WindowControls::new(controls_side);
    let title = pane_title(title);

    if controls_side == gtk::PackType::Start {
        content.append(&controls);
        content.append(&title);
    } else {
        title.set_hexpand(true);
        content.append(&title);
        content.append(&controls);
    }

    handle.set_child(Some(&content));
    handle
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
