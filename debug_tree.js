import { fetchWithAuth, authHeaders } from './tia-mapping-service/utils/allureAuth.js';
import config from './tia-mapping-service/config/index.js';
import databasePool from './tia-mapping-service/db/pool.js';

const projectId = 2;
const idsToCheck = [540224, 540238];

async function run() {
    try {
        console.log(`Checking project ${projectId}...`);

        // 1. Check Trees
        const treeUrl = `${config.allureBaseUrl}/api/tree?projectId=${projectId}`;
        console.log(`Fetching trees from ${treeUrl}...`);
        const res = await fetchWithAuth(treeUrl, { headers: authHeaders });
        const treeData = await res.json();
        console.log('Trees:', JSON.stringify(treeData, null, 2));

        // 2. Check DB
        console.log(`Checking DB for IDs: ${idsToCheck.join(', ')}`);
        const nodes = await databasePool('functional_blocks')
            .whereIn('allure_id', idsToCheck.map(id => id.toString()))
            .andWhere({ project_id: projectId.toString() })
            .select('allure_id', 'name', 'node_type', 'layer');
        console.log('DB Nodes:', nodes);

    } catch (e) {
        console.error(e);
    } finally {
        databasePool.destroy();
    }
}

run();
