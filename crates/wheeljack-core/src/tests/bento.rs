use super::support::*;
use crate::*;

#[test]
fn bento_layout_matches_reference_row_major_fill() {
    let core = Core::new(test_init("bento-layout"), Arc::new(NullEventSink)).expect("core");
    let nodes = (0..7)
        .map(|index| json!({ "id": format!("node_{index}"), "zIndex": index }))
        .collect::<Vec<_>>();
    let request = json!({
        "id": "bento",
        "command": "bento_layout",
        "payload": {
            "nodes": nodes,
            "viewport": { "width": 1280, "height": 720 }
        }
    });

    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["columns"], 3);
    assert_eq!(response["payload"]["rows"], 3);
    assert_eq!(
        response["payload"]["placements"]["node_0"],
        json!({ "column": 1, "row": 1, "columnSpan": 1, "rowSpan": 1 })
    );
    assert_eq!(
        response["payload"]["placements"]["node_6"],
        json!({ "column": 1, "row": 3, "columnSpan": 3, "rowSpan": 1 })
    );
}

#[test]
fn bento_layout_orders_by_z_index_and_honors_explicit_spans() {
    let core = Core::new(test_init("bento-layout-spans"), Arc::new(NullEventSink)).expect("core");
    let request = json!({
        "id": "bento",
        "command": "bento_layout",
        "payload": {
            "nodes": [
                { "id": "late", "zIndex": 3 },
                { "id": "wide", "zIndex": 1, "colSpan": 2 },
                { "id": "tall", "zIndex": 2, "rowSpan": 2 },
                { "id": "last", "zIndex": 4 }
            ],
            "viewport": { "width": 1280, "height": 720 }
        }
    });

    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();
    assert_eq!(
        response["payload"]["nodes"],
        json!(["wide", "tall", "late", "last"])
    );
    assert_eq!(response["payload"]["columns"], 2);
    assert_eq!(
        response["payload"]["placements"]["wide"],
        json!({ "column": 1, "row": 1, "columnSpan": 2, "rowSpan": 1 })
    );
    assert_eq!(
        response["payload"]["placements"]["tall"],
        json!({ "column": 1, "row": 2, "columnSpan": 1, "rowSpan": 2 })
    );
}

#[test]
fn bento_layout_caps_auto_columns_to_useful_viewport_width() {
    let core = Core::new(
        test_init("bento-layout-column-cap"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let nodes = (0..20)
        .map(|index| json!({ "id": format!("node_{index}"), "zIndex": index }))
        .collect::<Vec<_>>();
    let request = json!({
        "id": "bento",
        "command": "bento_layout",
        "payload": {
            "nodes": nodes,
            "viewport": { "width": 1280, "height": 720 }
        }
    });

    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();

    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["columns"], 4);
}

#[test]
fn bento_layout_without_explicit_spans_keeps_first_pane_compact() {
    let core = Core::new(
        test_init("bento-layout-reset-spans"),
        Arc::new(NullEventSink),
    )
    .expect("core");
    let nodes = (0..6)
        .map(|index| json!({ "id": format!("node_{index}"), "zIndex": index }))
        .collect::<Vec<_>>();
    let request = json!({
        "id": "bento",
        "command": "bento_layout",
        "payload": {
            "nodes": nodes,
            "viewport": { "width": 1280, "height": 720 }
        }
    });

    let response: Value = serde_json::from_str(&core.call_json(&request.to_string())).unwrap();

    assert_eq!(response["ok"], true);
    assert_eq!(response["payload"]["columns"], 3);
    assert_eq!(
        response["payload"]["placements"]["node_0"],
        json!({ "column": 1, "row": 1, "columnSpan": 1, "rowSpan": 1 })
    );
}
