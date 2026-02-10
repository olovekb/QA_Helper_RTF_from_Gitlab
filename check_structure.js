import databasePool from './tia-mapping-service/db/pool.js';

async function check() {
    try {
        const total = await databasePool('functional_blocks').count('id as count').first();
        console.log('Total functional blocks:', total.count);

        const byType = await databasePool('functional_blocks')
            .select('node_type')
            .count('id as count')
            .groupBy('node_type');

        console.log('Blocks by node_type:', byType);

        // Check specific group
        const group = await databasePool('functional_blocks').where('allure_id', '5163844').first();
        if (group) {
            console.log('Group 5163844 found:', group);
            const children = await databasePool('functional_blocks').where('parent_id', group.id);
            console.log(`Children of 5163844 (${children.length}):`, children.map(c => `${c.node_type}:${c.name}`));
        } else {
            console.log('Group 5163844 NOT found in DB');
        }

    } catch (e) {
        console.error(e);
    } finally {
        databasePool.destroy();
    }
}

check();
