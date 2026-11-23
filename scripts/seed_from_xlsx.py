"""Build seed SQL (staff list) from the payroll spreadsheet.

Usage:
    python3 scripts/seed_from_xlsx.py <payroll.xlsx>

Writes seed/seed.sql (git-ignored: it holds staff names and IDs). Apply it with:
    npx wrangler d1 execute hr-leave-tracker --remote --file seed/seed.sql

The sheet needs a header row containing "HR Name", "ITS Id/Login Id", "Office Name" and "Currency".
"""

import os
import sys

import openpyxl


def q(v):
    if v is None or str(v).strip() == "":
        return "NULL"
    return "'" + str(v).strip().replace("'", "''") + "'"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]

    ws = openpyxl.load_workbook(path, data_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    header_idx = next(i for i, r in enumerate(rows) if r and "HR Name" in [str(c).strip() if c else "" for c in r])
    header = [str(c).strip() if c else "" for c in rows[header_idx]]
    col = {name: header.index(name) for name in ("HR Name", "ITS Id/Login Id", "Office Name", "Currency")}

    out = ["DELETE FROM requests;", "DELETE FROM employees;", "DELETE FROM sqlite_sequence WHERE name IN ('employees','requests');"]
    count = 0
    for r in rows[header_idx + 1 :]:
        name = r[col["HR Name"]]
        if not name or not str(name).strip():
            continue
        its = r[col["ITS Id/Login Id"]]
        its = str(int(its)) if isinstance(its, float) else its
        out.append(
            "INSERT INTO employees (name, its_id, department, currency) VALUES ({}, {}, {}, {});".format(
                q(" ".join(str(name).split())), q(its), q(r[col["Office Name"]]), q(str(r[col["Currency"]] or "").upper())
            )
        )
        count += 1

    os.makedirs("seed", exist_ok=True)
    with open("seed/seed.sql", "w") as f:
        f.write("\n".join(out) + "\n")
    print(f"Wrote seed/seed.sql with {count} staff.")


if __name__ == "__main__":
    main()
