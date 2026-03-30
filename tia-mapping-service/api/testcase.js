
import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js';
import config from '../config/index.js';
import databasePool from '../db/pool.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';

/**
 * Helper to recursively find all parent functional blocks in our DB
 */
async function getAllParentBlocks(databasePool, startBlockUuid, projectId) {
    const path = [];
    let currentUuid = startBlockUuid;
    const visited = new Set();

    while (currentUuid && !visited.has(currentUuid)) {
        visited.add(currentUuid);
        const block = await databasePool('functional_blocks')
            .where({ id: currentUuid, project_id: projectId })
            .first();

        if (!block) break;
        path.push(block);
        currentUuid = block.parent_id;
    }
    return path;
}

export const createStubTestCase = async (req, res) => {
    const { projectId, parentId, name, issueKey } = req.body; // parentId here is allure_id

    if (!projectId || !parentId || !name) {
        return res.status(400).json({ error: 'Missing required fields: projectId, parentId, name' });
    }

    try {
        logInfo(`Request to create stub test case "${name}" in group ${parentId} (Project ${projectId})`);
        if (issueKey) logInfo(`Will link test case to issue: ${issueKey}`);

        // 1. Find the target group and its parents in our DB
        const group = await databasePool('functional_blocks')
            .where({ allure_id: parentId.toString(), project_id: projectId })
            .first();

        if (!group) {
            return res.status(404).json({ error: `Group ${parentId} not found in local DB. Cannot determine path.` });
        }

        const fullPath = await getAllParentBlocks(databasePool, group.id, projectId);
        logInfo(`Found path for group ${parentId}: ${fullPath.map(b => b.name).reverse().join(' > ')}`);

        // 2. Fetch Allure Tree Metadata to map Custom Field Names to IDs
        const treeUrl = `${config.allureBaseUrl}/api/tree?projectId=${projectId}`;
        const treeRes = await fetchWithAuth(treeUrl, { headers: authHeaders });
        if (!treeRes.ok) throw new Error(`Failed to fetch tree list: ${await treeRes.text()}`);
        const treeData = await treeRes.json();

        const nocodeProjectIds = ['1', '307', '377'];
        let structureTree = treeData.content?.find(item =>
            nocodeProjectIds.includes(String(projectId))
                ? (item.name === "Global Structure" || item.name === "Structure")
                : item.name === "Structure"
        );

        const treeId = structureTree?.id || 0;
        if (!treeId) throw new Error(`Could not find structure tree for project ${projectId}`);

        const treeDetailUrl = `${config.allureBaseUrl}/api/tree/${treeId}`;
        const treeDetailRes = await fetchWithAuth(treeDetailUrl, { headers: authHeaders });
        if (!treeDetailRes.ok) throw new Error(`Failed to fetch tree details: ${await treeDetailRes.text()}`);
        const treeDetailData = await treeDetailRes.json();
        const customFieldsSchema = treeDetailData.fields || [];

        // 3. Create the Test Case (Step 1: Basic info)
        logInfo(`Creating test case base: "${name}" in project ${projectId}`);
        const createUrl = `${config.allureBaseUrl}/api/testcase`;
        const createBody = { name, projectId: parseInt(projectId, 10) };

        const createRes = await fetchWithAuth(createUrl, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(createBody)
        });

        if (!createRes.ok) throw new Error(`Allure API Create Error: ${await createRes.text()}`);

        const newTc = await createRes.json();
        const testCaseId = newTc.id;
        logInfo(`Test case base created: ID ${testCaseId}`);

        // 4. Set Custom Fields for the entire path (Step 2: Linking to groups)
        // We collect all custom fields from the path: Feature, Story, Scenario, etc.
        const cfvBody = [];
        const seenCfIds = new Set();

        for (const block of fullPath) {
            const cfName = block.custom_field_name;
            if (!cfName) continue;

            const schemaField = customFieldsSchema.find(cf => cf.name.toLowerCase() === cfName.toLowerCase());
            if (schemaField && !seenCfIds.has(schemaField.id)) {
                cfvBody.push({
                    customField: { id: schemaField.id },
                    name: block.name
                });
                seenCfIds.add(schemaField.id);
            }
        }

        if (cfvBody.length > 0) {
            logInfo(`Setting ${cfvBody.length} custom fields for TC ${testCaseId} sequentially...`);
            const cfvUrl = `${config.allureBaseUrl}/api/testcase/${testCaseId}/cfv`;

            // ВАЖНО: Делаем запросы ПОСЛЕДОВАТЕЛЬНО, чтобы избежать ошибок 500 от Allure
            for (const fieldUpdate of cfvBody) {
                try {
                    logInfo(`Updating field ${fieldUpdate.customField.id} (${fieldUpdate.name})...`);
                    const cfvRes = await fetchWithAuth(cfvUrl, {
                        method: 'POST',
                        headers: { ...authHeaders, 'Content-Type': 'application/json' },
                        body: JSON.stringify([fieldUpdate]) // Шлем по одному полю в массиве
                    });

                    if (!cfvRes.ok) {
                        const errText = await cfvRes.text();
                        logError(`Failed to set field ${fieldUpdate.customField.id} for TC ${testCaseId}: ${cfvRes.status} - ${errText}`);
                    }
                } catch (e) {
                    logError(`Exception while setting field ${fieldUpdate.customField.id} for TC ${testCaseId}: ${e.message}`);
                }
            }
            logInfo(`Finished updating custom fields for TC ${testCaseId}`);
        } else {
            logWarn(`No custom fields found to set for TC ${testCaseId}`);
        }

        // 5. Link Test Case to Jira Issue (Step 3: Link to Jira)
        if (issueKey) {
            try {
                // Get integration ID
                let integrationId = 67; // Default
                const integrationUrl = `${config.allureBaseUrl}/api/integration/suggest?operation=issue_suggest&projectId=${projectId}`;
                const intResp = await fetchWithAuth(integrationUrl, { method: 'GET', headers: authHeaders });
                if (intResp.ok) {
                    const intData = await intResp.json();
                    const jiraInt = intData.content.find(i => i.name === 'Jira' || i.name.toLowerCase().includes('jira'));
                    if (jiraInt) integrationId = jiraInt.id;
                }

                logInfo(`Linking TC ${testCaseId} to issue ${issueKey} using integration ${integrationId}`);
                const issueUrl = `${config.allureBaseUrl}/api/testcase/${testCaseId}/issue`;
                const issueRes = await fetchWithAuth(issueUrl, {
                    method: 'POST',
                    headers: { ...authHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ integrationId, name: issueKey })
                });

                if (!issueRes.ok) {
                    logError(`Failed to link issue for TC ${testCaseId}: ${await issueRes.text()}`);
                } else {
                    logInfo(`Successfully linked TC ${testCaseId} to ${issueKey}`);
                }
            } catch (e) {
                logError(`Error linking issue for TC ${testCaseId}: ${e.message}`);
            }
        }

        res.json({ success: true, id: testCaseId, name: name });

    } catch (error) {
        logError(`Error creating stub test case: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};
