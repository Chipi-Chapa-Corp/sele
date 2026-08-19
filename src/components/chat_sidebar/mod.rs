use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use gtk::glib::prelude::*;
use gtk::prelude::*;
use gtk::{gio, glib};
use sele_core::{AgentSession, TranscriptSessionKey, cwd_display_name, group_sessions_by_cwd};

use super::chat_row::build_chat_content;
use super::{ChatStatus, ChatSummary, ChatView};

pub(super) const STYLE: &str = include_str!("style.css");

#[derive(Clone, Debug)]
enum TreeItem {
    Project(ProjectNode),
    Chat(ChatNode),
}

#[derive(Clone, Debug)]
struct ChatNode {
    summary: ChatSummary,
    search_text: String,
}

#[derive(Clone, Debug)]
struct ProjectNode {
    name: String,
    cwd: String,
    search_text: String,
    chats: Rc<[ChatNode]>,
}

impl ProjectNode {
    fn matches(&self, terms: &[String]) -> bool {
        matches_search(&self.search_text, terms)
            || self
                .chats
                .iter()
                .any(|chat| matches_search(&chat.search_text, terms))
    }
}

#[derive(Default)]
struct SearchState {
    terms: Vec<String>,
    child_filters: Vec<glib::WeakRef<gtk::CustomFilter>>,
}

#[derive(Default)]
struct CurrentChatState {
    key: Option<TranscriptSessionKey>,
    bound_rows: HashMap<TranscriptSessionKey, glib::WeakRef<gtk::Widget>>,
}

fn project_filter(search: Rc<RefCell<SearchState>>) -> gtk::CustomFilter {
    gtk::CustomFilter::new(move |object| {
        let Some(item) = object.downcast_ref::<glib::BoxedAnyObject>() else {
            return false;
        };
        let item = item.borrow::<TreeItem>();
        let TreeItem::Project(project) = &*item else {
            return false;
        };
        project.matches(&search.borrow().terms)
    })
}

fn filtered_chats(
    project: &ProjectNode,
    search: &Rc<RefCell<SearchState>>,
) -> gtk::FilterListModel {
    let children = gio::ListStore::new::<glib::BoxedAnyObject>();
    for chat in project.chats.iter().cloned() {
        children.append(&glib::BoxedAnyObject::new(TreeItem::Chat(chat)));
    }

    let project_search_text = project.search_text.clone();
    let search_for_filter = Rc::clone(search);
    let filter = gtk::CustomFilter::new(move |object| {
        let Some(item) = object.downcast_ref::<glib::BoxedAnyObject>() else {
            return false;
        };
        let item = item.borrow::<TreeItem>();
        let TreeItem::Chat(chat) = &*item else {
            return false;
        };
        let terms = &search_for_filter.borrow().terms;
        matches_search(&project_search_text, terms) || matches_search(&chat.search_text, terms)
    });
    search.borrow_mut().child_filters.push(filter.downgrade());

    gtk::FilterListModel::new(Some(children), Some(filter))
}

fn set_search_query(search: &RefCell<SearchState>, root_filter: &gtk::CustomFilter, query: &str) {
    let terms = normalize_search_terms(query);
    let child_filters = {
        let mut search = search.borrow_mut();
        if search.terms == terms {
            return;
        }
        search.terms = terms;
        search
            .child_filters
            .drain(..)
            .filter_map(|filter| filter.upgrade())
            .collect::<Vec<_>>()
    };

    root_filter.changed(gtk::FilterChange::Different);
    for filter in child_filters {
        filter.changed(gtk::FilterChange::Different);
        search.borrow_mut().child_filters.push(filter.downgrade());
    }
}

fn searchable_text<'a>(values: impl IntoIterator<Item = &'a str>) -> String {
    values
        .into_iter()
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_search_terms(query: &str) -> Vec<String> {
    query.split_whitespace().map(str::to_lowercase).collect()
}

fn matches_search(search_text: &str, terms: &[String]) -> bool {
    terms.iter().all(|term| search_text.contains(term))
}

#[derive(Clone)]
pub struct ChatSidebar {
    root_model: gio::ListStore,
    root_filter: gtk::CustomFilter,
    tree_model: gtk::TreeListModel,
    selection: gtk::SingleSelection,
    list: gtk::ListView,
    status: gtk::Label,
    current_chat: Rc<RefCell<CurrentChatState>>,
    search: Rc<RefCell<SearchState>>,
    chat_view: ChatView,
}

impl ChatSidebar {
    pub fn new(chat_view: ChatView) -> Self {
        let root_model = gio::ListStore::new::<glib::BoxedAnyObject>();
        let search = Rc::new(RefCell::new(SearchState::default()));
        let root_filter = project_filter(Rc::clone(&search));
        let filtered_root =
            gtk::FilterListModel::new(Some(root_model.clone()), Some(root_filter.clone()));
        let search_for_children = Rc::clone(&search);
        let tree_model = gtk::TreeListModel::new(filtered_root, false, true, move |object| {
            let item = object
                .downcast_ref::<glib::BoxedAnyObject>()?
                .borrow::<TreeItem>();
            let TreeItem::Project(project) = &*item else {
                return None;
            };
            Some(filtered_chats(project, &search_for_children).upcast())
        });
        let selection = gtk::SingleSelection::new(Some(tree_model.clone()));
        selection.set_autoselect(false);
        selection.set_can_unselect(false);

        let current_chat = Rc::new(RefCell::new(CurrentChatState::default()));
        let list = gtk::ListView::new(
            Some(selection.clone()),
            Some(tree_factory(Rc::clone(&current_chat))),
        );
        list.add_css_class("chat-tree");
        list.add_css_class("navigation-sidebar");
        list.set_single_click_activate(true);
        connect_chat_hover(&list);

        let status = gtk::Label::new(Some("Loading chats…"));
        status.add_css_class("chat-list-status");
        status.set_wrap(true);
        status.set_xalign(0.0);

        let sidebar = Self {
            root_model,
            root_filter,
            tree_model,
            selection,
            list,
            status,
            current_chat,
            search,
            chat_view,
        };
        sidebar.connect_activation();
        sidebar
    }

    pub fn widget(&self) -> &gtk::ListView {
        &self.list
    }

    pub fn status_widget(&self) -> &gtk::Label {
        &self.status
    }

    pub fn bind_search_entry(&self, entry: &gtk::SearchEntry) {
        let search = Rc::clone(&self.search);
        let root_filter = self.root_filter.clone();
        entry.connect_search_changed(move |entry| {
            set_search_query(&search, &root_filter, entry.text().as_str());
        });
    }

    pub fn update(&self, sessions: &[AgentSession], failures: &[String], loading: bool) {
        let groups = group_sessions_by_cwd(sessions.iter().cloned());
        let current = self.current_chat.borrow().key.clone().filter(|key| {
            groups.iter().any(|group| {
                group.sessions.iter().any(|session| {
                    session.agent.id.as_str() == key.provider_id && session.id == key.session_id
                })
            })
        });
        let current = current.or_else(|| {
            groups
                .first()
                .and_then(|group| group.sessions.first())
                .map(|session| TranscriptSessionKey::new(session.agent.id.as_str(), &session.id))
        });
        set_current_chat(&self.current_chat, current.clone());

        let projects = groups
            .into_iter()
            .map(|group| {
                let cwd = group.cwd.display().to_string();
                let chats = group
                    .sessions
                    .into_iter()
                    .map(|session| {
                        let summary = ChatSummary::new(
                            &session.id,
                            session.agent.id.as_str(),
                            &session.agent.name,
                            &cwd,
                            session.display_title(),
                            session.updated_at,
                            ChatStatus::Idle,
                        );
                        let search_text = searchable_text([
                            summary.name.as_str(),
                            summary.agent_name.as_str(),
                            summary.cwd.as_str(),
                        ]);
                        ChatNode {
                            summary,
                            search_text,
                        }
                    })
                    .collect::<Vec<_>>()
                    .into();
                let name = cwd_display_name(&group.cwd);
                glib::BoxedAnyObject::new(TreeItem::Project(ProjectNode {
                    search_text: searchable_text([name.as_str(), cwd.as_str()]),
                    name,
                    cwd,
                    chats,
                }))
            })
            .collect::<Vec<_>>();
        self.root_model
            .splice(0, self.root_model.n_items(), &projects);

        if let Some(key) = current
            && let Some((position, chat)) = self.find_chat(&key)
        {
            self.selection.set_selected(position);
            self.chat_view.show_chat(&chat);
        }
        self.update_status(sessions.is_empty(), failures, loading);
    }

    fn connect_activation(&self) {
        let tree_model = self.tree_model.clone();
        let selection = self.selection.clone();
        let current_chat = Rc::clone(&self.current_chat);
        let chat_view = self.chat_view.clone();
        self.list.connect_activate(move |_, position| {
            let Some(row) = tree_model.row(position) else {
                return;
            };
            let Some(item) = row.item().and_downcast::<glib::BoxedAnyObject>() else {
                return;
            };
            match &*item.borrow::<TreeItem>() {
                TreeItem::Project(_) => row.set_expanded(!row.is_expanded()),
                TreeItem::Chat(chat) => {
                    let chat = &chat.summary;
                    set_current_chat(
                        &current_chat,
                        Some(TranscriptSessionKey::new(&chat.agent_id, &chat.id)),
                    );
                    selection.set_selected(position);
                    chat_view.show_chat(chat);
                }
            }
        });
    }

    fn find_chat(&self, key: &TranscriptSessionKey) -> Option<(u32, ChatSummary)> {
        (0..self.tree_model.n_items()).find_map(|position| {
            let row = self.tree_model.row(position)?;
            let item = row.item()?.downcast::<glib::BoxedAnyObject>().ok()?;
            let item = item.borrow::<TreeItem>();
            let TreeItem::Chat(chat) = &*item else {
                return None;
            };
            let chat = &chat.summary;
            (chat.agent_id == key.provider_id && chat.id == key.session_id)
                .then(|| (position, chat.clone()))
        })
    }

    fn update_status(&self, empty: bool, failures: &[String], loading: bool) {
        let text = if loading {
            if empty {
                "Loading chats…"
            } else {
                "Loading other agents…"
            }
        } else if !failures.is_empty() {
            if empty {
                "Couldn’t load chats"
            } else {
                "Some agents unavailable"
            }
        } else if empty {
            "No chats found"
        } else {
            self.status.set_visible(false);
            self.status.set_tooltip_text(None);
            return;
        };
        self.status.set_text(text);
        self.status.set_tooltip_text(
            (!failures.is_empty())
                .then(|| failures.join("\n"))
                .as_deref(),
        );
        self.status.set_visible(true);
    }
}

fn tree_factory(current_chat: Rc<RefCell<CurrentChatState>>) -> gtk::SignalListItemFactory {
    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("chat tree factory receives GtkListItem");
        let expander = gtk::TreeExpander::new();
        expander.set_indent_for_depth(false);
        expander.set_indent_for_icon(false);
        let content = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        content.set_hexpand(true);
        expander.set_child(Some(&content));
        list_item.set_child(Some(&expander));
    });
    factory.connect_bind(move |_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("chat tree factory receives GtkListItem");
        let row = list_item
            .item()
            .and_downcast::<gtk::TreeListRow>()
            .expect("chat tree model contains GtkTreeListRow");
        let item = row
            .item()
            .and_downcast::<glib::BoxedAnyObject>()
            .expect("chat tree row contains TreeItem");
        let expander = list_item
            .child()
            .and_downcast::<gtk::TreeExpander>()
            .expect("chat tree item is a GtkTreeExpander");
        let content = expander
            .child()
            .and_downcast::<gtk::Box>()
            .expect("chat tree expander child is a GtkBox");
        while let Some(child) = content.first_child() {
            content.remove(&child);
        }
        content.remove_css_class("chat-tree-project");
        content.remove_css_class("chat-tree-chat");
        expander.set_list_row(Some(&row));

        match &*item.borrow::<TreeItem>() {
            TreeItem::Project(project) => {
                content.add_css_class("chat-tree-project");
                content.set_tooltip_text(Some(&project.cwd));
                let label = gtk::Label::new(Some(&project.name));
                label.set_ellipsize(gtk::pango::EllipsizeMode::End);
                label.set_hexpand(true);
                label.set_xalign(0.0);
                content.append(&label);
                list_item.set_selectable(false);
            }
            TreeItem::Chat(chat) => {
                let chat = &chat.summary;
                content.add_css_class("chat-tree-chat");
                content.set_tooltip_text(Some(&format!("{} · {}", chat.agent_name, chat.name)));

                let rail = gtk::Box::new(gtk::Orientation::Vertical, 0);
                rail.add_css_class("chat-tree-rail");
                let guide = gtk::Box::new(gtk::Orientation::Vertical, 0);
                guide.add_css_class("chat-tree-guide");
                guide.set_halign(gtk::Align::Center);
                guide.set_vexpand(true);
                rail.append(&guide);

                let chat_content = build_chat_content(chat);
                bind_chat_row(&current_chat, chat, &chat_content);
                content.append(&rail);
                content.append(&chat_content);
                list_item.set_selectable(true);
            }
        }
    });
    factory.connect_unbind(|_, object| {
        let Some(list_item) = object.downcast_ref::<gtk::ListItem>() else {
            return;
        };
        if let Some(expander) = list_item.child().and_downcast::<gtk::TreeExpander>() {
            expander.set_list_row(None);
        }
    });
    factory
}

fn bind_chat_row(current_chat: &RefCell<CurrentChatState>, chat: &ChatSummary, row: &gtk::Box) {
    let key = TranscriptSessionKey::new(&chat.agent_id, &chat.id);
    let active = {
        let mut state = current_chat.borrow_mut();
        state
            .bound_rows
            .retain(|_, bound_row| bound_row.upgrade().is_some());
        state
            .bound_rows
            .insert(key.clone(), row.clone().upcast::<gtk::Widget>().downgrade());
        state.key.as_ref() == Some(&key)
    };
    set_chat_row_active(row, active);
}

fn set_current_chat(current_chat: &RefCell<CurrentChatState>, key: Option<TranscriptSessionKey>) {
    let bound_rows = {
        let mut state = current_chat.borrow_mut();
        state.key = key.clone();
        state
            .bound_rows
            .drain()
            .filter_map(|(row_key, bound_row)| {
                bound_row
                    .upgrade()
                    .map(|row| (row_key, row.downgrade(), row))
            })
            .collect::<Vec<_>>()
    };

    for (row_key, _, row) in &bound_rows {
        set_chat_row_active(row, key.as_ref() == Some(row_key));
    }

    let mut state = current_chat.borrow_mut();
    for (row_key, weak_row, _) in bound_rows {
        state.bound_rows.insert(row_key, weak_row);
    }
}

fn set_chat_row_active(row: &impl IsA<gtk::Widget>, active: bool) {
    if active {
        row.add_css_class("chat-row-selected");
    } else {
        row.remove_css_class("chat-row-selected");
    }
}

fn connect_chat_hover(list: &gtk::ListView) {
    let hovered = Rc::new(RefCell::new(None::<glib::WeakRef<gtk::Widget>>));
    let motion = gtk::EventControllerMotion::new();

    let weak_list = list.downgrade();
    let hovered_for_motion = Rc::clone(&hovered);
    motion.connect_motion(move |_, x, y| {
        let Some(list) = weak_list.upgrade() else {
            return;
        };
        let target = list
            .pick(x, y, gtk::PickFlags::DEFAULT)
            .and_then(chat_content_ancestor);
        set_hovered_chat(&hovered_for_motion, target);
    });

    motion.connect_leave(move |_| set_hovered_chat(&hovered, None));
    list.add_controller(motion);
}

fn chat_content_ancestor(mut widget: gtk::Widget) -> Option<gtk::Widget> {
    loop {
        if widget.has_css_class("chat-row-content") {
            return Some(widget);
        }
        widget = widget.parent()?;
    }
}

fn set_hovered_chat(
    hovered: &RefCell<Option<glib::WeakRef<gtk::Widget>>>,
    next: Option<gtk::Widget>,
) {
    let previous = hovered.borrow().as_ref().and_then(glib::WeakRef::upgrade);
    if previous == next {
        return;
    }
    if let Some(previous) = previous {
        previous.remove_css_class("chat-row-hovered");
    }
    if let Some(next) = &next {
        next.add_css_class("chat-row-hovered");
    }
    *hovered.borrow_mut() = next.map(|widget| widget.downgrade());
}

#[cfg(test)]
mod tests {
    use super::{matches_search, normalize_search_terms, searchable_text};

    #[test]
    fn search_is_case_insensitive_and_matches_all_terms() {
        let text = searchable_text(["Fix Native Search", "Codex", "/Projects/Sele"]);

        assert!(matches_search(&text, &normalize_search_terms("SELE codex")));
        assert!(!matches_search(
            &text,
            &normalize_search_terms("sele claude")
        ));
    }

    #[test]
    fn empty_search_matches_every_row() {
        assert!(matches_search("any chat", &normalize_search_terms("   ")));
    }
}
