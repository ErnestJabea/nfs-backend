import re

with open('step_201.txt', 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Let's find all occurrences of numbered lines, like:
# 80: ...
# 81: ...
# or lines in the output.
# The format in step 201 was:
# 1: import { Request, Response } from 'express';\r\n2: import ...
# Let's write a parser to extract all these numbered lines and map them by line number.

lines_dict = {}

# Match patterns like:
# 1: Content
# or \n1: Content
# but wait! Let's be careful about strings containing colons.
# Usually it starts at the beginning of a line or after a newline:
# e.g., "1: import"
pattern = re.compile(r'(?:^|\r?\n)(\d+):\s*(.*)')

# Let's find all matches
matches = re.finditer(r'(?:^|\r?\n)(\d+):\s*(.*)', text)
for m in matches:
    line_num = int(m.group(1))
    line_content = m.group(2)
    # Check if there's subsequent lines before the next line number
    lines_dict[line_num] = line_content

print("Parsed line numbers:", sorted(lines_dict.keys()))

# Let's write out lines 80 to 254 to a file
reconstructed = []
for i in range(1, 260):
    if i in lines_dict:
        reconstructed.append(lines_dict[i])
    else:
        print(f"Missing line {i}")

with open('reconstructed_controller.ts', 'w', encoding='utf-8') as out:
    out.write('\n'.join(reconstructed))
print("Saved reconstructed code to reconstructed_controller.ts")
