export function solveAssignment(costMatrix) {
    const rowCount = Array.isArray(costMatrix) ? costMatrix.length : 0;
    if (rowCount === 0) {
        return { assignment: [], totalCost: 0 };
    }

    const columnCount = Array.isArray(costMatrix[0]) ? costMatrix[0].length : 0;
    if (columnCount === 0) {
        throw new Error('Hungarian solver requires at least one column');
    }
    if (rowCount > columnCount) {
        throw new Error(`Hungarian solver expects rows <= columns, got ${rowCount} rows and ${columnCount} columns`);
    }

    const u = new Array(rowCount + 1).fill(0);
    const v = new Array(columnCount + 1).fill(0);
    const p = new Array(columnCount + 1).fill(0);
    const way = new Array(columnCount + 1).fill(0);

    for (let row = 1; row <= rowCount; row += 1) {
        p[0] = row;
        let column0 = 0;
        const minv = new Array(columnCount + 1).fill(Infinity);
        const used = new Array(columnCount + 1).fill(false);

        do {
            used[column0] = true;
            const row0 = p[column0];
            let delta = Infinity;
            let column1 = 0;

            for (let column = 1; column <= columnCount; column += 1) {
                if (used[column]) continue;

                const current = costMatrix[row0 - 1][column - 1] - u[row0] - v[column];
                if (current < minv[column]) {
                    minv[column] = current;
                    way[column] = column0;
                }
                if (minv[column] < delta) {
                    delta = minv[column];
                    column1 = column;
                }
            }

            for (let column = 0; column <= columnCount; column += 1) {
                if (used[column]) {
                    u[p[column]] += delta;
                    v[column] -= delta;
                } else {
                    minv[column] -= delta;
                }
            }

            column0 = column1;
        } while (p[column0] !== 0);

        do {
            const column1 = way[column0];
            p[column0] = p[column1];
            column0 = column1;
        } while (column0 !== 0);
    }

    const assignment = new Array(rowCount).fill(-1);
    for (let column = 1; column <= columnCount; column += 1) {
        if (p[column] > 0) {
            assignment[p[column] - 1] = column - 1;
        }
    }

    return {
        assignment,
        totalCost: -v[0]
    };
}
