const fs = require('fs');
let c = fs.readFileSync('server/server.js', 'utf8');

// Add ragContext to prompt
c = c.replace(
    `${logicSection ? \`ДОПОЛНИТЕЛЬНЫЕ ЛОГИЧЕСКИЕ ОГРАНИЧЕНИЯ:
\${logicSection}
\` : ''}
⚠️ ИНСТРУКЦИЯ ПО УСЛОВИЯМ:`,
    `${logicSection ? \`ДОПОЛНИТЕЛЬНЫЕ ЛОГИЧЕСКИЕ ОГРАНИЧЕНИЯ:
\${logicSection}
\` : ''}

\${ragContext ? \`📚 КОНТЕКСТ ИЗ ДОКУМЕНТАЦИИ (RAG):
\${ragContext}

Основной документ имеет приоритет над связанными документами.
\` : ''}
⚠️ ИНСТРУКЦИЯ ПО УСЛОВИЯМ:`
);

fs.writeFileSync('server/server.js', c);
console.log('Done updating prompt');
