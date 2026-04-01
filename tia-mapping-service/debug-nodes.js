import { fetchWithAuth, authHeaders, buildTestCaseTreeEntityUrl, getTestCaseTreeEntityContent } from './utils/allureAuth.js';
import config from './config/index.js';
import { logInfo, logError } from './utils/logger.js';
import { resolveGroupPathFromDb } from './utils/testCaseTreeEntity.js';

const projectId = '4'; // Hardcoded for this test
const treeId = '532'; // Hardcoded based on user logs

async function inspectNode(nodeId) {
    const pathPrefix = await resolveGroupPathFromDb(projectId, nodeId);
    const url = buildTestCaseTreeEntityUrl(config.allureBaseUrl, {
        projectId,
        treeId,
        page: 0,
        size: 100,
        pathPrefix
    });
    console.log(`Inspecting Node ID: ${nodeId}`);
    console.log(`Resolved path:`, pathPrefix);
    console.log(`URL: ${url}`);

    try {
        const response = await fetchWithAuth(url, { headers: { ...authHeaders } });
        console.log(`Status: ${response.status}`);

        if (!response.ok) {
            console.log('Error Body:', await response.text());
            return;
        }

        const data = await response.json();
        const children = getTestCaseTreeEntityContent(data);
        console.log('DATA (Children):');
        console.log(JSON.stringify(children, null, 2));
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
