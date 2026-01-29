import { fetchWithAuth, authHeaders } from './utils/allureAuth.js';
import config from './config/index.js';
import { logInfo, logError } from './utils/logger.js';

const projectId = '4'; // Hardcoded for this test
const treeId = '532'; // Hardcoded based on user logs

async function inspectNode(nodeId) {
    const url = `${config.allureBaseUrl}/api/v2/project/${projectId}/test-case/tree/tree-node?treeId=${treeId}&parentNodeId=${nodeId}&page=0&size=100`;
    console.log(`Inspecting Node ID: ${nodeId}`);
    console.log(`URL: ${url}`);

    try {
        const response = await fetchWithAuth(url, { headers: { ...authHeaders } });
        console.log(`Status: ${response.status}`);

        if (!response.ok) {
            console.log('Error Body:', await response.text());
            return;
        }

        const data = await response.json();
        console.log('DATA (Children):');
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Fetch error:', err.message);
    }
}

async function run() {
    await inspectNode('2893501'); // The problematic ID
    console.log('-----------------------------------');
    await inspectNode('12554');   // The "correct" ID according to user
}

run();
