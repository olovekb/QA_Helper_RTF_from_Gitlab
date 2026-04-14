// graphStore.mjs - Работа с Neo4j для хранения двухуровневого графа
// Уровень 1: Document → Section → Chunk (структура контента)
// Уровень 2: Сущности и связи (GraphRAG)

import neo4j from 'neo4j-driver';

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://neo4j:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';

let driver = null;

// === ТИПЫ УЗЛОВ ===
const CONTENT_NODE_TYPES = ['Document', 'Section', 'Chunk'];
const ENTITY_NODE_TYPES = ['RequirementFragment', 'ScenarioSeed', 'APIEndpoint', 'ResponseParam', 'UIElement', 'BusinessRule', 'ExternalRef'];
const ALL_NODE_TYPES = [...CONTENT_NODE_TYPES, ...ENTITY_NODE_TYPES];

// === ТИПЫ СВЯЗЕЙ (нижний уровень - структура контента) ===
const CONTENT_REL_TYPES = ['BELONGS_TO', 'IN_SECTION', 'NEXT', 'EXPLICIT_REF', 'SAME_SECTION_FLOW', 'SEMANTIC_SIMILAR'];

// === ТИПЫ СВЯЗЕЙ (верхний уровень - сущности) ===
const ENTITY_REL_TYPES = ['EXTRACTED_FROM', 'SEEDED_FROM', 'USES_METHOD', 'RETURNS_PARAM', 'CONTROLS_UI', 'REFERENCES', 'DEPENDS_ON', 'LOCATED_IN_CHUNK'];

const ALL_REL_TYPES = [...CONTENT_REL_TYPES, ...ENTITY_REL_TYPES];

export function initNeo4j() {
  if (!driver) {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    console.log('[graphStore] ✅ Драйвер Neo4j инициализирован:', NEO4J_URI);
  }
  return driver;
}

export async function closeNeo4j() {
  if (driver) {
    await driver.close();
    driver = null;
    console.log('[graphStore] 🔌 Подключение к Neo4j закрыто');
  }
}

export async function isNeo4jAvailable() {
  try {
    const d = initNeo4j();
    const session = d.session({ database: 'neo4j' });
    await session.run('RETURN 1');
    await session.close();
    console.log('[graphStore] ✅ Neo4j доступен');
    return true;
  } catch (e) {
    console.warn('[graphStore] ⚠️ Neo4j недоступен:', e.message);
    return false;
  }
}

export async function clearSession(sessionId) {
  const d = initNeo4j();
  const session = d.session({ database: 'neo4j' });
  try {
    await session.run(
      'MATCH (n) WHERE n.sessionId = $sessionId DETACH DELETE n',
      { sessionId }
    );
    console.log(`[graphStore] 🗑️ Сессия очищена: ${sessionId}`);
  } finally {
    await session.close();
  }
}

// === РАБОТА С УЗЛАМИ ===

export async function upsertNodes(nodes, sessionId) {
  if (!nodes || nodes.length === 0) return [];
  
  const d = initNeo4j();
  const session = d.session({ database: 'neo4j' });
  
  const created = [];
  
  try {
    for (const node of nodes) {
      const { type, name, properties } = node;
      
      if (!ALL_NODE_TYPES.includes(type)) {
        console.warn(`[graphStore] ⚠️ Неизвестный тип узла: ${type}, пропускаем`);
        continue;
      }
      
      const props = {
        sessionId,
        name,
        ...properties
      };
      
      const cypher = `
        MERGE (n:${type} {sessionId: $sessionId, name: $name})
        SET n += $props
        RETURN n
      `;
      
      const result = await session.run(cypher, { sessionId, name, props });
      created.push(result.records[0]?.get('n').properties);
    }
    
    console.log(`[graphStore] ✅ Создано узлов: ${created.length}`);
    return created;
  } finally {
    await session.close();
  }
}

export async function upsertRelationships(relationships, sessionId) {
  if (!relationships || relationships.length === 0) return;
  
  const d = initNeo4j();
  const session = d.session({ database: 'neo4j' });
  
  let createdCount = 0;
  
  try {
    for (const rel of relationships) {
      const { fromName, fromType, toName, toType, relType, properties } = rel;
      
      if (!ALL_REL_TYPES.includes(relType)) {
        console.warn(`[graphStore] ⚠️ Неизвестный тип связи: ${relType}, пропускаем`);
        continue;
      }
      
      if (!fromName || !toName) {
        console.warn(`[graphStore] ⚠️ Пропускаем связь без fromName или toName`);
        continue;
      }
      
      const props = properties || {};
      
      const cypher = `
        MATCH (a:${fromType} {sessionId: $sessionId, name: $fromName})
        MATCH (b:${toType} {sessionId: $sessionId, name: $toName})
        MERGE (a)-[r:${relType}]->(b)
        SET r += $props
      `;
      
      await session.run(cypher, { sessionId, fromName, toName, props });
      createdCount++;
    }
    
    console.log(`[graphStore] ✅ Создано связей: ${createdCount}`);
  } finally {
    await session.close();
  }
}

// === УДОБНЫЕ ФУНКЦИИ ДЛЯ ГРАФА ЧАНКОВ (нижний уровень) ===

export async function createDocument(sessionId, docId, title, pageId) {
  return upsertNodes([{
    type: 'Document',
    name: docId,
    properties: { title, pageId }
  }], sessionId);
}

export async function createSection(sessionId, sectionId, title, documentId) {
  return upsertNodes([{
    type: 'Section',
    name: sectionId,
    properties: { title, documentId }
  }], sessionId);
}

export async function createChunks(sessionId, chunks) {
  const nodes = chunks.map(c => ({
    type: 'Chunk',
    name: c.chunkId,
    properties: {
      position: c.position,
      content: c.content?.substring(0, 5000),
      pageId: c.pageId,
      sectionId: c.sectionId,
      documentId: c.documentId
    }
  }));
  return upsertNodes(nodes, sessionId);
}

export async function createChunkRelationships(sessionId, chunkRelationships) {
  const relationships = chunkRelationships.map(r => ({
    fromName: r.fromChunkId,
    fromType: 'Chunk',
    toName: r.toChunkId || r.toSectionId || r.toDocumentId,
    toType: r.toType || 'Chunk',
    relType: r.relType
  }));
  return upsertRelationships(relationships, sessionId);
}

// === УДОБНЫЕ ФУНКЦИИ ДЛЯ СУЩНОСТЕЙ (верхний уровень) ===

export async function createEntities(sessionId, entities) {
  const nodes = entities.map(e => ({
    type: e.type,
    name: e.name,
    properties: {
      ...e.properties,
      sourceChunkId: e.sourceChunkId,
      sourceDocumentId: e.sourceDocumentId
    }
  }));
  return upsertNodes(nodes, sessionId);
}

export async function createEntityRelationships(sessionId, entityRelationships) {
  return upsertRelationships(entityRelationships, sessionId);
}

// === ПОЛУЧЕНИЕ КОНТЕКСТА ДЛЯ LLM ===

export async function getLocalContext(sessionId, startNodeName, startNodeType, depth = 2) {
  const d = initNeo4j();
  const session = d.session({ database: 'neo4j' });
  
  try {
    const cypher = `
      MATCH (start:${startNodeType} {sessionId: $sessionId, name: $startName})
      MATCH path = (start)-[r:${ALL_REL_TYPES.join('|')}]->(end)
      WHERE end.sessionId = $sessionId
      WITH path, r, end, LENGTH(path) as pathLength
      WHERE pathLength <= $depth
      RETURN start.name as from, type(r) as relType, end.name as to, 
             labels(end)[0] as toType, end.description as description, 
             end.properties as props
      ORDER BY pathLength
    `;
    
    const result = await session.run(cypher, { 
      sessionId, 
      startName: startNodeName, 
      depth: neo4j.int(Number(depth) || 2)
    });
    
    const connections = result.records.map(r => ({
      from: r.get('from'),
      relType: r.get('relType'),
      to: r.get('to'),
      toType: r.get('toType'),
      description: r.get('description'),
      props: r.get('props')
    }));
    
    console.log(`[graphStore] 📊 Найдено связей: ${connections.length} для "${startNodeName}"`);
    return connections;
  } finally {
    await session.close();
  }
}

export async function getContextForScenarioSeed(sessionId, scenarioSeedName) {
  const connected = await getLocalContext(sessionId, scenarioSeedName, 'ScenarioSeed', depth = 2);
  
  const context = {
    requirementFragments: [],
    apiEndpoints: [],
    responseParams: [],
    uiElements: [],
    businessRules: [],
    externalRefs: [],
    chunks: []
  };
  
  for (const conn of connected) {
    const entry = {
      name: conn.to,
      relationship: conn.relType,
      description: conn.description,
      ...conn.props
    };
    
    switch (conn.toType) {
      case 'RequirementFragment':
        context.requirementFragments.push(entry);
        break;
      case 'APIEndpoint':
        context.apiEndpoints.push(entry);
        break;
      case 'ResponseParam':
        context.responseParams.push(entry);
        break;
      case 'UIElement':
        context.uiElements.push(entry);
        break;
      case 'BusinessRule':
        context.businessRules.push(entry);
        break;
      case 'ExternalRef':
        context.externalRefs.push(entry);
        break;
      case 'Chunk':
        context.chunks.push(entry);
        break;
    }
  }
  
  return context;
}

export async function getContextForRequirementFragment(sessionId, reqFragmentName) {
  const connected = await getLocalContext(sessionId, reqFragmentName, 'RequirementFragment', depth = 2);
  
  const context = {
    scenarioSeeds: [],
    apiEndpoints: [],
    responseParams: [],
    uiElements: [],
    businessRules: [],
    externalRefs: [],
    relatedRequirements: []
  };
  
  for (const conn of connected) {
    const entry = {
      name: conn.to,
      relationship: conn.relType,
      description: conn.description,
      ...conn.props
    };
    
    switch (conn.toType) {
      case 'ScenarioSeed':
        context.scenarioSeeds.push(entry);
        break;
      case 'APIEndpoint':
        context.apiEndpoints.push(entry);
        break;
      case 'ResponseParam':
        context.responseParams.push(entry);
        break;
      case 'UIElement':
        context.uiElements.push(entry);
        break;
      case 'BusinessRule':
        context.businessRules.push(entry);
        break;
      case 'ExternalRef':
        context.externalRefs.push(entry);
        break;
      case 'RequirementFragment':
        context.relatedRequirements.push(entry);
        break;
    }
  }
  
  return context;
}

// === ПОЛУЧЕНИЕ СТРУКТУРЫ ГРАФА ===

export async function getGraphStats(sessionId) {
  const d = initNeo4j();
  const session = d.session({ database: 'neo4j' });
  
  try {
    const nodesCypher = `
      MATCH (n)
      WHERE n.sessionId = $sessionId
      RETURN labels(n)[0] as type, count(n) as count
    `;
    const nodesResult = await session.run(nodesCypher, { sessionId });
    const nodesByType = nodesResult.records.map(r => ({
      type: r.get('type'),
      count: neo4j.integer.inSafeRange(r.get('count')) ? r.get('count').toNumber() : Number(r.get('count').toString())
    }));
    
    const relsCypher = `
      MATCH (a)-[r]->(b)
      WHERE a.sessionId = $sessionId
      RETURN type(r) as relType, count(r) as count
    `;
    const relsResult = await session.run(relsCypher, { sessionId });
    const relsByType = relsResult.records.map(r => ({
      relType: r.get('relType'),
      count: neo4j.integer.inSafeRange(r.get('count')) ? r.get('count').toNumber() : Number(r.get('count').toString())
    }));
    
    return {
      nodes: nodesByType,
      relationships: relsByType,
      totalNodes: nodesByType.reduce((sum, n) => sum + n.count, 0),
      totalRelationships: relsByType.reduce((sum, r) => sum + r.count, 0)
    };
  } finally {
    await session.close();
  }
}

export async function getAllNodes(sessionId, limit = 100) {
  const d = initNeo4j();
  const session = d.session({ database: 'neo4j' });
  
  try {
    const cypher = `
      MATCH (n)
      WHERE n.sessionId = $sessionId
      RETURN n.name as name, labels(n)[0] as type, n.description as description, 
             n.sourceChunkId as sourceChunkId, n.pageId as pageId, properties(n) as props
      LIMIT $limit
    `;
    
    const result = await session.run(cypher, {
      sessionId,
      limit: neo4j.int(Number(limit) || 100)
    });
    
    return result.records.map(r => ({
      name: r.get('name'),
      type: r.get('type'),
      description: r.get('description'),
      sourceChunkId: r.get('sourceChunkId'),
      pageId: r.get('pageId'),
      properties: r.get('props') || {}
    }));
  } finally {
    await session.close();
  }
}

export async function getAllRelationships(sessionId, limit = 100) {
  const d = initNeo4j();
  const session = d.session({ database: 'neo4j' });
  
  try {
    const cypher = `
      MATCH (a)-[r]->(b)
      WHERE a.sessionId = $sessionId
      RETURN a.name as from, type(r) as relType, b.name as to, 
             labels(a)[0] as fromType, labels(b)[0] as toType
      LIMIT $limit
    `;
    
    const result = await session.run(cypher, {
      sessionId,
      limit: neo4j.int(Number(limit) || 100)
    });
    
    return result.records.map(r => ({
      from: r.get('from'),
      fromType: r.get('fromType'),
      relType: r.get('relType'),
      to: r.get('to'),
      toType: r.get('toType')
    }));
  } finally {
    await session.close();
  }
}

export function isNeo4jInitialized() {
  return driver !== null;
}

export { ALL_NODE_TYPES, ALL_REL_TYPES, CONTENT_NODE_TYPES, ENTITY_NODE_TYPES, CONTENT_REL_TYPES, ENTITY_REL_TYPES };
