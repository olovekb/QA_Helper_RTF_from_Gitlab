import databasePool from './tia-mapping-service/db/pool.js';

const idsToCheck = ['540224', '540238'];
const projectId = '2';

async function run() {
    try {
        console.log(`Checking children for IDs: ${idsToCheck.join(', ')}`);

        // 1. Get the nodes themselves to get their UUIDs
        const nodes = await databasePool('functional_blocks')
            .whereIn('allure_id', idsToCheck)
            .andWhere({ project_id: projectId })
            .select('id', 'allure_id', 'name', 'node_type');

        console.log('Parent Nodes:', nodes);

        for (const node of nodes) {
            // 2. Get children
            const children = await databasePool('functional_blocks')
                .where('parent_id', node.id)
                .select('allure_id', 'name', 'node_type');

            console.log(`Children of ${node.name} (${node.allure_id}):`);
            if (children.length > 0) {
                children.forEach(c => console.log(` - [${c.node_type}] ${c.name} (${c.allure_id})`));
            } else {
                console.log(' - NO CHILDREN FOUND in DB');
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        databasePool.destroy();
    }
}

run();
