
import fetch from 'node-fetch';

const ALLURE_BASE_URL = 'https://abanking.qatools.cloud';
const ALLURE_TOKEN = 'cc865667-ca13-4f69-a5c9-77579586f571';
const PROJECT_ID = 2;
const TREE_ID = 399;
const GROUP_ID = 540351; // Problematic group

// Helper for auth headers
const getAuthHeaders = () => ({
    'Authorization': `Bearer ${ALLURE_TOKEN}`,
    'Content-Type': 'application/json'
});

async function checkGroup(groupId, leaf = false) {
    const leafParam = leaf ? '&leaf=true' : '';
    const url = `${ALLURE_BASE_URL}/api/v2/project/${PROJECT_ID}/test-case/tree/tree-node?treeId=${TREE_ID}&parentNodeId=${groupId}&page=0&size=100${leafParam}`;

    console.log(`Checking URL: ${url}`);

    try {
        const response = await fetch(url, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`);
            console.error(await response.text());
            return;
        }

        const data = await response.json();
        console.log(`Response for leaf=${leaf}:`);
        console.log(`Total children: ${data.children?.content?.length || 0}`);
        if (data.children?.content?.length > 0) {
            data.children.content.forEach(child => {
                console.log(` - [${child.type}] ${child.id}: ${child.name}`);
            });
        } else {
            console.log(" - (Empty)");
        }
    } catch (e) {
        console.error("Fetch error:", e.message);
    }
}

async function run() {
    console.log(`Inspecting Group ${GROUP_ID} in Project ${PROJECT_ID}, Tree ${TREE_ID}`);

    console.log("\n--- Checking without leaf=true (only groups) ---");
    await checkGroup(GROUP_ID, false);

    console.log("\n--- Checking WITH leaf=true (including test cases) ---");
    await checkGroup(GROUP_ID, true);
}

run();
