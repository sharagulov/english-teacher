export function parseCsv(input: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    const text = input.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
        }
        else if (char === ',') {
            row.push(field);
            field = '';
        }
        else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else if (char !== '\r') {
            field += char;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}
export function parseCsvObjects(input: string): Record<string, string>[] {
    const rows = parseCsv(input);
    const header = rows.shift();
    if (!header)
        return [];
    return rows
        .filter((r) => r.some((cell) => cell.trim().length > 0))
        .map((r) => {
        const obj: Record<string, string> = {};
        header.forEach((key, index) => {
            obj[key.trim()] = (r[index] ?? '').trim();
        });
        return obj;
    });
}
