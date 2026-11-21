// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
// Written from scratch from the published reading policy: the same
// answers, faster by slicing fields out of the text instead of building
// them one character at a time.
//
// The policy, in short: a U+FEFF at the very start is dropped; a record
// ends at LF or CRLF and an empty line is no record; outside quotes a CR
// not followed by LF is dropped (stray_cr); a field that opens with a
// quote runs to the next quote that is not doubled, "" inside it is one
// quote and each CRLF or lone CR inside it reads as LF, what follows its
// closing quote up to the next comma or line break is appended as it
// stands (quote_junk, when the field ends); a quote that never closes is
// a literal character and the text after it is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is literal;
// fields stay strings, never trimmed or converted; columns is the first
// record when header is true, else null; rows are the records after it,
// each padded with "" or cut to the first record's width (short_row /
// long_row); each error is {code, line, row} in the order met, line the
// 1-based line its record starts on, row its record's index in rows
// (null for the header).

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows
  // (null for the header). readUnquoted pushes its stray_cr errors here.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the
  // field, how it ended (0 comma, 1 line break, 2 end of text) and how
  // many characters were kept onto it.
  function readUnquoted(value) {
    let added = 0;
    while (pos < len) {
      const comma = text.indexOf(',', pos);
      const nl = text.indexOf('\n', pos);
      let end;
      let ended;
      if (comma !== -1 && (nl === -1 || comma < nl)) {
        end = comma;
        ended = 0;
      } else if (nl !== -1) {
        end = nl;
        ended = 1;
      } else {
        end = len;
        ended = 2;
      }
      // A CR right before the line break is the CRLF's, not a stray one.
      let segEnd = end;
      if (ended === 1 && end > pos && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
      const seg = text.slice(pos, segEnd);
      if (seg.indexOf('\r') === -1) {
        if (seg.length !== 0) {
          value += seg;
          added += seg.length;
        }
      } else {
        // Stray CRs: one error each, dropped from the value.
        const parts = seg.split('\r');
        for (let i = 1; i < parts.length; i++) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        }
        const cleaned = parts.join('');
        if (cleaned.length !== 0) {
          value += cleaned;
          added += cleaned.length;
        }
      }
      if (ended === 0) {
        pos = end + 1;
        return { value, ended: 0, added };
      }
      if (ended === 1) {
        pos = end + 1;
        line += 1;
        return { value, ended: 1, added };
      }
      pos = len;
      return { value, ended: 2, added };
    }
    return { value, ended: 2, added };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the whole record holds no quote and no stray CR, so its
    // fields are one split of the line.
    let fields = null;
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? len : nl;
    let contentEnd = segEnd;
    if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) contentEnd = segEnd - 1;
    if (contentEnd > pos) {
      const seg = text.slice(pos, contentEnd);
      if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
        fields = seg.split(',');
        pos = nl === -1 ? len : nl + 1;
        if (nl !== -1) line += 1;
      }
    }

    if (fields === null) {
      // Slow path: field by field.
      fields = [];
      let ended = 0;
      let lastQuoted = false;
      do {
        if (pos < len && text.charCodeAt(pos) === 34) {
          lastQuoted = true;
          const open = pos;
          const openLine = line;
          let scan = pos + 1;
          let parts = null;
          let closedAt = -1;
          while (true) {
            const q = text.indexOf('"', scan);
            if (q === -1) break;
            if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
              if (parts === null) parts = [];
              parts.push(text.slice(scan, q), '"');
              scan = q + 2;
              continue;
            }
            closedAt = q;
            break;
          }
          if (closedAt === -1) {
            // The quote never closes: it is a literal character, and the
            // text after it is read again as unquoted.
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            pos = open + 1;
            line = openLine;
            const r = readUnquoted('"');
            fields.push(r.value);
            ended = r.ended;
            continue;
          }
          let value;
          if (parts === null) {
            value = text.slice(scan, closedAt);
          } else {
            parts.push(text.slice(scan, closedAt));
            value = parts.join('');
          }
          // Each CRLF or lone CR inside reads as LF; every line break
          // inside counts once toward the line.
          if (value.indexOf('\r') !== -1) value = value.replace(/\r\n?/g, '\n');
          let d = 0;
          let idx = -1;
          while ((idx = value.indexOf('\n', idx + 1)) !== -1) d += 1;
          line += d;
          pos = closedAt + 1;
          if (pos >= len) {
            fields.push(value);
            ended = 2;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              fields.push(value);
              ended = 0;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              fields.push(value);
              ended = 1;
            } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              fields.push(value);
              ended = 1;
            } else {
              // What follows the closing quote is appended as it stands.
              const r = readUnquoted(value);
              if (r.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              fields.push(r.value);
              ended = r.ended;
            }
          }
        } else {
          lastQuoted = false;
          const r = readUnquoted('');
          fields.push(r.value);
          ended = r.ended;
        }
      } while (ended === 0);

      // A line that held only stray CRs is left with no characters: no
      // record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
