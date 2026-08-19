mod button;
mod chat_row;
mod chat_sidebar;
mod chat_view;
mod workspace;

pub use chat_row::{ChatStatus, ChatSummary};
pub use chat_sidebar::ChatSidebar;
pub use chat_view::ChatView;
pub use workspace::build_workspace;

pub(crate) const STYLES: &[&str] = &[
    workspace::STYLE,
    chat_row::STYLE,
    chat_sidebar::STYLE,
    chat_view::STYLE,
];
