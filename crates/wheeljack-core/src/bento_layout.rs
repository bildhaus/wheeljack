use super::*;

const BENTO_MAX_COLUMNS: usize = 6;
const BENTO_MAX_ROWSPAN: usize = 4;
const BENTO_MIN_AUTO_COLUMN_WIDTH: f64 = 260.0;

#[derive(Debug)]
struct PlacedBentoNode {
    id: String,
    row: usize,
    col: usize,
    col_span: usize,
    row_span: usize,
    auto: bool,
}

pub(crate) fn build_bento_layout(req: BentoLayoutRequest) -> BentoLayoutResponse {
    let mut nodes = req.nodes;
    if nodes
        .windows(2)
        .any(|pair| pair[0].z_index > pair[1].z_index)
    {
        nodes.sort_by_key(|node| node.z_index);
    }
    if nodes.is_empty() {
        return BentoLayoutResponse {
            nodes: Vec::new(),
            placements: HashMap::new(),
            columns: 1,
            rows: 1,
        };
    }

    let count = nodes.len() as f64;
    let view_aspect = (req.viewport.width / req.viewport.height.max(1.0)).clamp(0.5, 2.6);
    let target_cell_aspect = 1.35;
    let auto_column_cap = ((req.viewport.width / BENTO_MIN_AUTO_COLUMN_WIDTH).floor() as usize)
        .clamp(1, BENTO_MAX_COLUMNS);
    let base_columns = ((count * view_aspect / target_cell_aspect).sqrt().round() as usize)
        .clamp(1, auto_column_cap);
    let widest_explicit = nodes
        .iter()
        .filter_map(|node| node.col_span)
        .map(|span| clamp_bento_span(span, BENTO_MAX_COLUMNS))
        .max()
        .unwrap_or(1);
    let columns = base_columns
        .max(widest_explicit)
        .clamp(1, BENTO_MAX_COLUMNS);
    let mut occupied: Vec<Vec<bool>> = Vec::new();
    let mut row_fill: Vec<usize> = Vec::new();
    let mut placed: Vec<PlacedBentoNode> = Vec::new();
    let mut first_available_row = 0usize;

    for node in &nodes {
        let col_span = clamp_bento_span(node.col_span.unwrap_or(1.0), columns);
        let row_span = clamp_bento_span(node.row_span.unwrap_or(1.0), BENTO_MAX_ROWSPAN);
        let (row, col) = first_free_bento_cell(
            &mut occupied,
            &mut row_fill,
            columns,
            first_available_row,
            col_span,
            row_span,
        );
        for r in row..row + row_span {
            ensure_bento_row(&mut occupied, &mut row_fill, columns, r);
            for cell in occupied[r].iter_mut().skip(col).take(col_span) {
                *cell = true;
            }
            row_fill[r] += col_span;
        }
        placed.push(PlacedBentoNode {
            id: node.id.clone(),
            row,
            col,
            col_span,
            row_span,
            auto: node.col_span.is_none(),
        });
        while row_fill
            .get(first_available_row)
            .map(|fill| *fill >= columns)
            .unwrap_or(false)
        {
            first_available_row += 1;
        }
    }

    for pane in &mut placed {
        if !pane.auto || pane.row_span != 1 {
            continue;
        }
        let right_edge = pane.col + pane.col_span;
        let mut extend = 0usize;
        while right_edge + extend < columns && !occupied[pane.row][right_edge + extend] {
            extend += 1;
        }
        if extend > 0 {
            for cell in occupied[pane.row].iter_mut().skip(right_edge).take(extend) {
                *cell = true;
                row_fill[pane.row] += 1;
            }
            pane.col_span += extend;
        }
    }

    let ordered_ids = nodes.into_iter().map(|node| node.id).collect();
    let placements = placed
        .into_iter()
        .map(|pane| {
            (
                pane.id,
                BentoPlacementDto {
                    column: pane.col + 1,
                    row: pane.row + 1,
                    column_span: pane.col_span,
                    row_span: pane.row_span,
                },
            )
        })
        .collect();

    BentoLayoutResponse {
        nodes: ordered_ids,
        placements,
        columns,
        rows: occupied.len().max(1),
    }
}

fn clamp_bento_span(value: f64, max: usize) -> usize {
    (value.round() as isize).clamp(1, max as isize) as usize
}

fn ensure_bento_row(
    occupied: &mut Vec<Vec<bool>>,
    row_fill: &mut Vec<usize>,
    columns: usize,
    row: usize,
) {
    while occupied.len() <= row {
        occupied.push(vec![false; columns]);
        row_fill.push(0);
    }
}

fn bento_cells_free(
    occupied: &mut Vec<Vec<bool>>,
    row_fill: &mut Vec<usize>,
    columns: usize,
    row: usize,
    col: usize,
    col_span: usize,
    row_span: usize,
) -> bool {
    for r in row..row + row_span {
        ensure_bento_row(occupied, row_fill, columns, r);
        if occupied[r]
            .iter()
            .skip(col)
            .take(col_span)
            .any(|cell| *cell)
        {
            return false;
        }
    }
    true
}

fn first_free_bento_cell(
    occupied: &mut Vec<Vec<bool>>,
    row_fill: &mut Vec<usize>,
    columns: usize,
    first_available_row: usize,
    col_span: usize,
    row_span: usize,
) -> (usize, usize) {
    for row in first_available_row.. {
        ensure_bento_row(occupied, row_fill, columns, row + row_span - 1);
        for col in 0..=columns - col_span {
            if bento_cells_free(occupied, row_fill, columns, row, col, col_span, row_span) {
                return (row, col);
            }
        }
    }
    unreachable!()
}
