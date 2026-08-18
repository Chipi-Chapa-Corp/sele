use std::rc::Rc;

use gtk::prelude::*;

use super::chat_row::{ChatSummary, build_chat_row};

pub(super) const STYLE: &str = include_str!("style.css");

#[derive(Clone)]
pub struct ChatProject {
    root: gtk::Expander,
    list: gtk::ListBox,
    chats: Rc<[ChatSummary]>,
}

impl ChatProject {
    pub fn new(project_name: &str, chats: impl Into<Rc<[ChatSummary]>>) -> Self {
        let chats = chats.into();
        let root = gtk::Expander::new(Some(project_name));
        root.add_css_class("chat-project");
        root.set_expanded(true);
        root.set_hexpand(true);

        let list = gtk::ListBox::new();
        list.add_css_class("chat-list");
        list.add_css_class("navigation-sidebar");
        list.set_activate_on_single_click(true);
        list.set_hexpand(true);
        list.set_selection_mode(gtk::SelectionMode::Single);

        for chat in chats.iter() {
            list.append(&build_chat_row(chat));
        }

        let project_body = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        project_body.add_css_class("project-body");
        project_body.set_hexpand(true);

        let project_rail = gtk::Box::new(gtk::Orientation::Vertical, 0);
        project_rail.add_css_class("project-rail");

        let project_line = gtk::Box::new(gtk::Orientation::Vertical, 0);
        project_line.add_css_class("project-line");
        project_line.set_halign(gtk::Align::Center);
        project_line.set_vexpand(true);
        project_rail.append(&project_line);

        project_body.append(&project_rail);
        project_body.append(&list);
        root.set_child(Some(&project_body));

        Self { root, list, chats }
    }

    pub fn widget(&self) -> &gtk::Expander {
        &self.root
    }

    pub fn select(&self, index: usize) {
        let row = self.list.row_at_index(index as i32);
        self.list.select_row(row.as_ref());
    }

    pub fn connect_chat_activated<F>(&self, callback: F)
    where
        F: Fn(usize, &ChatSummary) + 'static,
    {
        let chats = Rc::clone(&self.chats);
        self.list.connect_row_activated(move |_, row| {
            let index = row.index() as usize;
            if let Some(chat) = chats.get(index) {
                callback(index, chat);
            }
        });
    }
}
