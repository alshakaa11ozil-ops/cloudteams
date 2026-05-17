import * as Y from 'yjs';

function yjsNodeToHtml(node: Y.XmlElement | Y.XmlText | Y.XmlFragment): string {
    if (!node) return '';

    if (node instanceof Y.XmlFragment) {
        const children = typeof (node as any).toArray === 'function'
            ? (node as any).toArray() as any[]
            : Array.from(node as unknown as Iterable<any>)
        return children.filter(Boolean).map((c: any) => yjsNodeToHtml(c)).join('')
    }

    if ((node as any).nodeName) {
        const el = node as unknown as Y.XmlElement
        const tag = el.nodeName
        const attrs = el.getAttributes()
        const children = Array.from(el as unknown as Iterable<any>).map((c: any) => yjsNodeToHtml(c)).join('')

        switch (tag) {
            case 'paragraph': return `<p>${children || '<br>'}</p>`
            default: return `<div>${children}</div>`
        }
    }

    if (node instanceof Y.XmlText) {
        // Use toDelta() to correctly process formatted text segments safely
        const delta = node.toDelta();
        let result = '';
        for (const op of delta) {
            if (typeof op.insert === 'string') {
                let segment = op.insert
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/\n/g, '<br>');
                
                const attrs = op.attributes || {};
                if (attrs.code) segment = `<code>${segment}</code>`;
                if (attrs.bold) segment = `<strong>${segment}</strong>`;
                if (attrs.italic) segment = `<em>${segment}</em>`;
                if (attrs.underline) segment = `<u>${segment}</u>`;
                if (attrs.strike) segment = `<s>${segment}</s>`;
                if (attrs.link) {
                    const href = typeof attrs.link === 'object' ? attrs.link.href : attrs.link;
                    const target = typeof attrs.link === 'object' ? attrs.link.target || '_blank' : '_blank';
                    segment = `<a href="${href}" target="${target}" rel="noopener noreferrer nofollow">${segment}</a>`;
                }
                result += segment;
            } else {
                // If the insert is an object (like an embed), stringify safely or ignore
            }
        }
        return result;
    }

    return '';
}

const doc = new Y.Doc();
const fragment = doc.getXmlFragment('default');
const textWithAttributes = new Y.XmlText();
fragment.insert(0, [textWithAttributes]);
textWithAttributes.applyDelta([{ insert: 'user typed <script>' }, { insert: 'some bold text', attributes: { bold: true } }]);

console.log('Resulting HTML:');
console.log(yjsNodeToHtml(fragment));
