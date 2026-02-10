import databasePool from './db/pool.js';

async function verifyFix() {
    const projectId = '2';
    // Mock mappings with Allure IDs
    const mappings = {
        'Scenario - Перейти в профиль': ['1106499', '539989']
    };

    console.log('--- VERIFYING HEATMAP IMPORT FIX ---');

    try {
        await databasePool.transaction(async (trx) => {
            // 1. Collect allure IDs
            const allureFbIds = new Set();
            Object.values(mappings).forEach(fbIds => {
                if (Array.isArray(fbIds)) {
                    fbIds.forEach(id => {
                        if (id != null && id !== '') allureFbIds.add(id.toString());
                    });
                }
            });
            console.log('Unique Allure IDs collected:', Array.from(allureFbIds));

            // 2. Get mapping
            const fbMappings = await trx('functional_blocks')
                .where({ project_id: projectId })
                .whereIn('allure_id', Array.from(allureFbIds))
                .select('id', 'allure_id');

            console.log('Found database mappings:', fbMappings.map(m => `${m.allure_id} -> ${m.id}`));

            const allureToUuidMap = new Map(fbMappings.map(m => [m.allure_id, m.id]));

            // 3. Map for insertion
            for (const [compName, fbIds] of Object.entries(mappings)) {
                const validFbUuids = fbIds
                    .map(id => id ? allureToUuidMap.get(id.toString()) : null)
                    .filter(uuid => uuid != null);

                console.log(`Component "${compName}" valid UUIDs:`, validFbUuids);

                if (validFbUuids.length > 0) {
                    // Verify if they are actual UUIDs (simple regex)
                    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                    const allValid = validFbUuids.every(uuid => uuidRegex.test(uuid));
                    if (allValid) {
                        console.log('SUCCESS: All IDs were correctly mapped to UUIDs.');
                    } else {
                        console.log('FAILURE: Some mapped IDs are not valid UUIDs.');
                    }
                }
            }

            // Do not actually commit anything
            throw new Error('ROLLBACK_INTENTIONAL');
        });
    } catch (e) {
        if (e.message !== 'ROLLBACK_INTENTIONAL') {
            console.error('Verification Error:', e.message);
        } else {
            console.log('Verification finished (rollback successful).');
        }
    } finally {
        process.exit(0);
    }
}

verifyFix();
