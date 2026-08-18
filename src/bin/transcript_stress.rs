use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::env;
use std::process::ExitCode;
use std::rc::Rc;
use std::time::Duration;

use gtk::glib::prelude::*;
use gtk::prelude::*;
use gtk::{gio, glib};

const APPLICATION_ID: &str = "dev.sele.TranscriptStress";
const ANCHOR_DRIFT_TOLERANCE: f32 = 1.0;
const MAX_BOUND_ROW_WIDGETS: usize = 512;

#[derive(Clone, Copy, Debug)]
struct Config {
    rows: u32,
    page_size: u32,
    cycles: u32,
    verify: bool,
}

impl Config {
    fn from_args() -> Result<Self, String> {
        let mut config = Self {
            rows: 20_000,
            page_size: 200,
            cycles: 10,
            verify: false,
        };
        for argument in env::args().skip(1) {
            if argument == "--verify" {
                config.verify = true;
            } else if let Some(value) = argument.strip_prefix("--rows=") {
                config.rows = parse_positive("rows", value)?;
            } else if let Some(value) = argument.strip_prefix("--page-size=") {
                config.page_size = parse_positive("page-size", value)?;
            } else if let Some(value) = argument.strip_prefix("--cycles=") {
                config.cycles = parse_positive("cycles", value)?;
            } else {
                return Err(format!("unknown argument: {argument}"));
            }
        }
        Ok(config)
    }
}

fn parse_positive(name: &str, value: &str) -> Result<u32, String> {
    value
        .parse::<u32>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("--{name} must be a positive integer"))
}

#[derive(Debug)]
struct StressRow {
    id: i64,
    text: String,
}

#[derive(Clone, Default)]
struct BoundRows(Rc<RefCell<HashMap<i64, glib::WeakRef<gtk::Box>>>>);

impl BoundRows {
    fn bind(&self, id: i64, row: &gtk::Box) {
        self.0.borrow_mut().insert(id, row.downgrade());
    }

    fn unbind(&self, id: i64) {
        self.0.borrow_mut().remove(&id);
    }

    fn visible_anchor(&self, viewport: &gtk::ScrolledWindow) -> Option<Anchor> {
        let viewport_height = viewport.height() as f32;
        let mut dead = Vec::new();
        let mut candidates = Vec::new();
        for (id, weak_row) in self.0.borrow().iter() {
            let Some(row) = weak_row.upgrade() else {
                dead.push(*id);
                continue;
            };
            let Some(bounds) = row.compute_bounds(viewport) else {
                continue;
            };
            let top = bounds.y();
            let bottom = top + bounds.height();
            if bottom > 0.0 && top < viewport_height {
                candidates.push(Anchor { id: *id, top });
            }
        }
        for id in dead {
            self.0.borrow_mut().remove(&id);
        }
        candidates.into_iter().min_by(|left, right| {
            left.top
                .partial_cmp(&right.top)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    }

    fn top_for(&self, id: i64, viewport: &gtk::ScrolledWindow) -> Option<f32> {
        self.0
            .borrow()
            .get(&id)
            .and_then(glib::WeakRef::upgrade)
            .and_then(|row| row.compute_bounds(viewport))
            .map(|bounds| bounds.y())
    }

    fn live_count(&self) -> usize {
        self.0
            .borrow()
            .values()
            .filter(|row| row.upgrade().is_some())
            .count()
    }
}

#[derive(Clone, Copy, Debug)]
struct Anchor {
    id: i64,
    top: f32,
}

#[derive(Clone)]
struct HarnessModel {
    store: gio::ListStore,
    next_front_id: Rc<Cell<i64>>,
    next_back_id: Rc<Cell<i64>>,
    prepended: Rc<Cell<u32>>,
    page_size: u32,
    status: gtk::Label,
}

impl HarnessModel {
    fn prepend_page(&self) {
        let end = self.next_front_id.get();
        let start = end - i64::from(self.page_size);
        let additions = make_rows(start..end);
        self.store.splice(0, 0, &additions);
        self.next_front_id.set(start);
        self.prepended
            .set(self.prepended.get().saturating_add(self.page_size));
        self.update_status("Prepended variable-height page");
    }

    fn remove_prepend_page(&self) {
        let removals = self.page_size.min(self.prepended.get());
        if removals == 0 {
            self.update_status("No prepended page to remove");
            return;
        }
        self.store
            .splice(0, removals, &[] as &[glib::BoxedAnyObject]);
        self.next_front_id
            .set(self.next_front_id.get() + i64::from(removals));
        self.prepended.set(self.prepended.get() - removals);
        self.update_status("Removed oldest loaded page");
    }

    fn append_page(&self) {
        let start = self.next_back_id.get();
        let end = start + i64::from(self.page_size);
        let additions = make_rows(start..end);
        self.store.splice(self.store.n_items(), 0, &additions);
        self.next_back_id.set(end);
        self.update_status("Appended variable-height page");
    }

    fn update_status(&self, action: &str) {
        self.status.set_text(&format!(
            "{action} · {} logical rows · {} prepended",
            self.store.n_items(),
            self.prepended.get()
        ));
    }
}

fn main() -> ExitCode {
    let config = match Config::from_args() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::FAILURE;
        }
    };
    let failed = Rc::new(Cell::new(false));
    let application = gtk::Application::builder()
        .application_id(APPLICATION_ID)
        .flags(gio::ApplicationFlags::NON_UNIQUE)
        .build();

    let failed_for_activate = Rc::clone(&failed);
    application.connect_activate(move |application| {
        build_harness(application, config, Rc::clone(&failed_for_activate));
    });
    let exit_code = application.run_with_args(&["transcript-stress"]);
    if failed.get() || exit_code != glib::ExitCode::SUCCESS {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn build_harness(application: &gtk::Application, config: Config, failed: Rc<Cell<bool>>) {
    let store = gio::ListStore::new::<glib::BoxedAnyObject>();
    append_in_batches(&store, 0..i64::from(config.rows));

    let bound_rows = BoundRows::default();
    let factory = build_factory(bound_rows.clone());
    let selection = gtk::NoSelection::new(Some(store.clone()));
    let list = gtk::ListView::new(Some(selection), Some(factory));
    list.set_vexpand(true);

    let viewport = gtk::ScrolledWindow::new();
    viewport.set_hscrollbar_policy(gtk::PolicyType::Never);
    viewport.set_vexpand(true);
    viewport.set_child(Some(&list));

    let status = gtk::Label::new(None);
    status.set_hexpand(true);
    status.set_xalign(0.0);
    let model = HarnessModel {
        store,
        next_front_id: Rc::new(Cell::new(0)),
        next_back_id: Rc::new(Cell::new(i64::from(config.rows))),
        prepended: Rc::new(Cell::new(0)),
        page_size: config.page_size,
        status: status.clone(),
    };
    model.update_status("Ready");

    let controls = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    controls.set_margin_top(8);
    controls.set_margin_bottom(8);
    controls.set_margin_start(8);
    controls.set_margin_end(8);
    controls.append(&status);
    controls.append(&action_button("Prepend", {
        let model = model.clone();
        move || model.prepend_page()
    }));
    controls.append(&action_button("Remove oldest", {
        let model = model.clone();
        move || model.remove_prepend_page()
    }));
    controls.append(&action_button("Append", {
        let model = model.clone();
        move || model.append_page()
    }));
    controls.append(&action_button("Middle", {
        let list = list.clone();
        move || {
            let position = list
                .model()
                .map(|model| model.n_items() / 2)
                .unwrap_or_default();
            list.scroll_to(position, gtk::ListScrollFlags::NONE, None);
        }
    }));

    let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content.append(&controls);
    content.append(&viewport);

    let window = gtk::ApplicationWindow::builder()
        .application(application)
        .title("Sele transcript anchor stress harness")
        .default_width(820)
        .default_height(720)
        .child(&content)
        .build();
    window.present();

    if config.verify {
        run_verification(
            application.clone(),
            config,
            model,
            list,
            viewport,
            bound_rows,
            failed,
        );
    }
}

fn build_factory(bound_rows: BoundRows) -> gtk::SignalListItemFactory {
    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("factory setup must receive a GtkListItem");
        let row = gtk::Box::new(gtk::Orientation::Vertical, 0);
        row.set_hexpand(true);
        row.set_margin_top(4);
        row.set_margin_bottom(4);
        row.set_margin_start(12);
        row.set_margin_end(12);

        let label = gtk::Label::new(None);
        label.set_hexpand(true);
        label.set_selectable(true);
        label.set_wrap(true);
        label.set_wrap_mode(gtk::pango::WrapMode::WordChar);
        label.set_xalign(0.0);
        row.append(&label);
        list_item.set_child(Some(&row));
    });

    let rows_for_bind = bound_rows.clone();
    factory.connect_bind(move |_, object| {
        let list_item = object
            .downcast_ref::<gtk::ListItem>()
            .expect("factory bind must receive a GtkListItem");
        let item = list_item
            .item()
            .and_downcast::<glib::BoxedAnyObject>()
            .expect("stress model contains BoxedAnyObject rows");
        let data = item.borrow::<StressRow>();
        let row = list_item
            .child()
            .and_downcast::<gtk::Box>()
            .expect("stress row is a GtkBox");
        let label = row
            .first_child()
            .and_downcast::<gtk::Label>()
            .expect("stress row child is a GtkLabel");
        label.set_text(&data.text);
        rows_for_bind.bind(data.id, &row);
    });

    factory.connect_unbind(move |_, object| {
        let Some(list_item) = object.downcast_ref::<gtk::ListItem>() else {
            return;
        };
        let Some(item) = list_item.item().and_downcast::<glib::BoxedAnyObject>() else {
            return;
        };
        let id = item.borrow::<StressRow>().id;
        bound_rows.unbind(id);
    });
    factory
}

fn action_button(label: &str, action: impl Fn() + 'static) -> gtk::Button {
    let button = gtk::Button::with_label(label);
    button.connect_clicked(move |_| action());
    button
}

fn run_verification(
    application: gtk::Application,
    config: Config,
    model: HarnessModel,
    list: gtk::ListView,
    viewport: gtk::ScrolledWindow,
    bound_rows: BoundRows,
    failed: Rc<Cell<bool>>,
) {
    glib::MainContext::default().spawn_local(async move {
        glib::timeout_future(Duration::from_millis(250)).await;
        list.scroll_to(config.rows / 2, gtk::ListScrollFlags::NONE, None);
        glib::timeout_future(Duration::from_millis(500)).await;

        let mut maximum_drift = 0.0_f32;
        let mut maximum_bound_rows = bound_rows.live_count();
        for cycle in 0..config.cycles {
            let Some(before_prepend) = bound_rows.visible_anchor(&viewport) else {
                verification_failed(&model, &failed, "could not identify a visible anchor row");
                application.quit();
                return;
            };
            model.prepend_page();
            glib::timeout_future(Duration::from_millis(100)).await;
            let Some(after_prepend) = bound_rows.top_for(before_prepend.id, &viewport) else {
                verification_failed(&model, &failed, "anchor row was recycled after prepend");
                application.quit();
                return;
            };
            let prepend_drift = (after_prepend - before_prepend.top).abs();
            maximum_drift = maximum_drift.max(prepend_drift);
            maximum_bound_rows = maximum_bound_rows.max(bound_rows.live_count());

            let Some(before_remove) = bound_rows.visible_anchor(&viewport) else {
                verification_failed(&model, &failed, "could not identify anchor before removal");
                application.quit();
                return;
            };
            model.remove_prepend_page();
            glib::timeout_future(Duration::from_millis(100)).await;
            let Some(after_remove) = bound_rows.top_for(before_remove.id, &viewport) else {
                verification_failed(&model, &failed, "anchor row was recycled after removal");
                application.quit();
                return;
            };
            let remove_drift = (after_remove - before_remove.top).abs();
            maximum_drift = maximum_drift.max(remove_drift);
            maximum_bound_rows = maximum_bound_rows.max(bound_rows.live_count());

            model.status.set_text(&format!(
                "Verification cycle {}/{} · maximum drift {:.3} px · {} bound rows",
                cycle + 1,
                config.cycles,
                maximum_drift,
                maximum_bound_rows
            ));
        }

        if maximum_drift > ANCHOR_DRIFT_TOLERANCE {
            verification_failed(
                &model,
                &failed,
                &format!(
                    "anchor drift {:.3} px exceeded {:.1} px tolerance",
                    maximum_drift, ANCHOR_DRIFT_TOLERANCE
                ),
            );
        } else if maximum_bound_rows > MAX_BOUND_ROW_WIDGETS {
            verification_failed(
                &model,
                &failed,
                &format!(
                    "GTK bound {maximum_bound_rows} row widgets; expected at most {MAX_BOUND_ROW_WIDGETS}"
                ),
            );
        } else {
            model.status.set_text(&format!(
                "PASS · {} cycles · maximum drift {:.3} px · {} bound rows",
                config.cycles, maximum_drift, maximum_bound_rows
            ));
            println!(
                "transcript anchor verification passed: {} logical rows, {} cycles, maximum drift {:.3} px, {} bound row widgets",
                config.rows, config.cycles, maximum_drift, maximum_bound_rows
            );
        }
        glib::timeout_future(Duration::from_millis(250)).await;
        application.quit();
    });
}

fn verification_failed(model: &HarnessModel, failed: &Cell<bool>, message: &str) {
    failed.set(true);
    model.status.set_text(&format!("FAIL · {message}"));
    eprintln!("transcript anchor verification failed: {message}");
}

fn append_in_batches(store: &gio::ListStore, range: std::ops::Range<i64>) {
    const BATCH_SIZE: i64 = 1_000;
    let mut start = range.start;
    while start < range.end {
        let end = (start + BATCH_SIZE).min(range.end);
        let additions = make_rows(start..end);
        store.splice(store.n_items(), 0, &additions);
        start = end;
    }
}

fn make_rows(range: std::ops::Range<i64>) -> Vec<glib::BoxedAnyObject> {
    range
        .map(|id| {
            glib::BoxedAnyObject::new(StressRow {
                id,
                text: variable_height_text(id),
            })
        })
        .collect()
}

fn variable_height_text(id: i64) -> String {
    let magnitude = id.unsigned_abs();
    let lines = if magnitude.is_multiple_of(4_093) {
        240
    } else if magnitude.is_multiple_of(257) {
        48
    } else {
        usize::try_from(magnitude % 9 + 1).unwrap_or(1)
    };
    let body = format!(
        "Variable-height transcript row {id}. GTK must retain its visible anchor while pages are spliced before it."
    );
    std::iter::repeat_n(body, lines)
        .enumerate()
        .map(|(line, text)| format!("{}: {text}", line + 1))
        .collect::<Vec<_>>()
        .join("\n")
}
