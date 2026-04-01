import { fetchWithAuth, authHeaders, buildTestCaseTreeEntityUrl, getTestCaseTreeEntityContent } from './utils/allureAuth.js';
import config from './config/index.js';
import { resolveGroupPathFromDb } from './utils/testCaseTreeEntity.js';

async function fetchLeafTestCasesRecursive(projectId, treeId, parentNodeId, mode = 'FULL') {
    const allTestCaseIds = [];

    const initialPath = await resolveGroupPathFromDb(projectId, parentNodeId);

    async function collect(currentPath, isInitial = false) {
        try {
            const url = buildTestCaseTreeEntityUrl(config.allureBaseUrl, {
                projectId,
                treeId,
                page: 0,
                size: 100,
                pathPrefix: currentPath
            });
            const res = await fetchWithAuth(url, { headers: authHeaders });
            if (!res.ok) return;
            const data = await res.json();
            const children = getTestCaseTreeEntityContent(data);

            for (const child of children) {
                if (child.type === 'LEAF' && child.testCaseId) {
                    allTestCaseIds.push(child.testCaseId);
                } else if (child.type === 'GROUP') {
                    if (mode === 'FULL') {
                        await collect([...currentPath, Number(child.id)]);
                    } else if (mode === 'SELECTIVE' && isInitial) {
                        console.log(`  [SKIP] Skipping nested group ${child.id} (${child.name}) in SELECTIVE mode`);
                    }
                }
            }
        } catch (err) { }
    }
    await collect(initialPath, true);
    return [...new Set(allTestCaseIds)];
}

async function diagnose() {
    const projectId = 305;
    const treeId = 656;
    const storyId = 4265924; // Story "Загрузить обязательные документы"

    console.log(`--- SELECTIVE VS FULL VERIFICATION ---`);

    try {
        console.log(`\n1. Testing SELECTIVE mode (Story logic) for ID ${storyId}:`);
        const resultSelective = await fetchLeafTestCasesRecursive(projectId, treeId, storyId, 'SELECTIVE');
        console.log(`Found ${resultSelective.length} test cases:`, resultSelective);

        console.log(`\n2. Testing FULL mode (Feature logic) for ID ${storyId}:`);
        const resultFull = await fetchLeafTestCasesRecursive(projectId, treeId, storyId, 'FULL');
        console.log(`Found ${resultFull.length} test cases:`, resultFull);

        if (resultSelective.length < resultFull.length) {
            console.log('\nSUCCESS: Selective mode correctly excluded nested scenarios.');
        } else {
            console.log('\nERROR: Selective mode result is same as Full mode!');
        }

    } catch (e) {
        console.error('Diagnosis Error:', e.message);
    }
}

diagnose();
