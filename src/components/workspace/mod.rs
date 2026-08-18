use std::cell::RefCell;
use std::rc::Rc;

use gtk::prelude::*;
use sele_agent::{DiscoveryEvent, discover_builtin_sessions};
use sele_core::{AgentSession, cwd_display_name, group_sessions_by_cwd};

use super::{ChatProject, ChatStatus, ChatSummary, ChatView};

pub(super) const STYLE: &str = include_str!("style.css");

pub fn build_workspace() -> gtk::Paned {
    let chat_list_content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    chat_list_content.add_css_class("chat-list-content");
    chat_list_content.append(&chat_list_status("Loading chats…"));

    let chat_list_scroll = gtk::ScrolledWindow::new();
    chat_list_scroll.set_hscrollbar_policy(gtk::PolicyType::Never);
    chat_list_scroll.set_min_content_width(220);
    chat_list_scroll.set_vexpand(true);
    chat_list_scroll.set_child(Some(&chat_list_content));

    let chat_list = workspace_pane("chat-list-pane", 220);
    chat_list.append(&side_header("Chats", gtk::PackType::Start));
    chat_list.append(&chat_list_scroll);

    let transcript = ChatView::new();

    let chat_view = workspace_pane("chat-view-pane", 320);
    chat_view.append(&chat_drag_strip());
    chat_view.append(transcript.widget());

    let sidebar = workspace_pane("sidebar-pane", 240);
    sidebar.append(&side_header("Sidebar", gtk::PackType::End));

    load_chat_list(chat_list_content, transcript);

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

fn load_chat_list(chat_list_content: gtk::Box, chat_view: ChatView) {
    let receiver = discover_builtin_sessions();
    let sessions = Rc::new(RefCell::new(Vec::new()));
    let failures = Rc::new(RefCell::new(Vec::new()));
    let selected = Rc::new(RefCell::new(None));

    gtk::glib::MainContext::default().spawn_local(async move {
        while let Ok(event) = receiver.recv().await {
            match event {
                DiscoveryEvent::AgentLoaded {
                    agent: _,
                    sessions: discovered,
                } => {
                    sessions.borrow_mut().extend(discovered);
                    render_chat_list(
                        &chat_list_content,
                        &chat_view,
                        &sessions.borrow(),
                        &failures.borrow(),
                        &selected,
                        true,
                    );
                }
                DiscoveryEvent::AgentFailed { agent, error } => {
                    failures
                        .borrow_mut()
                        .push(format!("{}: {error}", agent.name));
                }
                DiscoveryEvent::EngineFailed(error) => failures.borrow_mut().push(error),
                DiscoveryEvent::Finished => {
                    render_chat_list(
                        &chat_list_content,
                        &chat_view,
                        &sessions.borrow(),
                        &failures.borrow(),
                        &selected,
                        false,
                    );
                    break;
                }
            }
        }
    });
}

fn render_chat_list(
    container: &gtk::Box,
    chat_view: &ChatView,
    sessions: &[AgentSession],
    failures: &[String],
    selected: &Rc<RefCell<Option<(String, String)>>>,
    loading: bool,
) {
    while let Some(child) = container.first_child() {
        container.remove(&child);
    }

    let groups = group_sessions_by_cwd(sessions.iter().cloned());
    if groups.is_empty() {
        let message = if loading {
            "Loading chats…"
        } else if failures.is_empty() {
            "No chats found"
        } else {
            "Couldn’t load chats"
        };
        let status = chat_list_status(message);
        set_failures_tooltip(&status, failures);
        container.append(&status);
        return;
    }

    let current_selection = selected.borrow().clone().filter(|(agent_id, session_id)| {
        groups.iter().any(|group| {
            group
                .sessions
                .iter()
                .any(|session| session.agent.id.as_str() == agent_id && session.id == *session_id)
        })
    });
    let current_selection = current_selection.or_else(|| {
        groups
            .first()
            .and_then(|group| group.sessions.first())
            .map(|session| (session.agent.id.as_str().to_owned(), session.id.clone()))
    });
    *selected.borrow_mut() = current_selection.clone();

    let project_lists = Rc::new(RefCell::new(Vec::<gtk::glib::WeakRef<gtk::ListBox>>::new()));

    for group in groups {
        let cwd = group.cwd.display().to_string();
        let chats: Rc<[ChatSummary]> = group
            .sessions
            .iter()
            .map(|session| {
                ChatSummary::new(
                    &session.id,
                    session.agent.id.as_str(),
                    &session.agent.name,
                    &cwd,
                    session.display_title(),
                    session.updated_at.clone(),
                    ChatStatus::Idle,
                )
            })
            .collect::<Vec<_>>()
            .into();
        let project = ChatProject::new(&cwd_display_name(&group.cwd), Rc::clone(&chats));
        project.widget().set_tooltip_text(Some(&cwd));

        let project_lists_for_activation = Rc::clone(&project_lists);
        let active_list = project.list().downgrade();
        let selected_for_activation = Rc::clone(selected);
        let chat_view_for_activation = chat_view.clone();
        project.connect_chat_activated(move |index, chat| {
            for list in project_lists_for_activation.borrow().iter() {
                if let Some(list) = list.upgrade() {
                    list.unselect_all();
                }
            }
            if let Some(list) = active_list.upgrade() {
                let row = list.row_at_index(index as i32);
                list.select_row(row.as_ref());
            }
            *selected_for_activation.borrow_mut() = Some((chat.agent_id.clone(), chat.id.clone()));
            chat_view_for_activation.show_chat(chat);
        });
        project_lists.borrow_mut().push(project.list().downgrade());

        if let Some((agent_id, session_id)) = &current_selection
            && let Some(index) = chats
                .iter()
                .position(|chat| chat.agent_id == *agent_id && chat.id == *session_id)
        {
            project.select(index);
            chat_view.show_chat(&chats[index]);
        }

        container.append(project.widget());
    }

    if loading {
        container.append(&chat_list_status("Loading other agents…"));
    } else if !failures.is_empty() {
        let status = chat_list_status("Some agents unavailable");
        set_failures_tooltip(&status, failures);
        container.append(&status);
    }
}

fn chat_list_status(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("chat-list-status");
    label.set_wrap(true);
    label.set_xalign(0.0);
    label
}

fn set_failures_tooltip(widget: &impl IsA<gtk::Widget>, failures: &[String]) {
    if !failures.is_empty() {
        widget.set_tooltip_text(Some(&failures.join("\n")));
    }
}
