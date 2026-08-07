import json

log_path = r"C:\Users\ND Fashion\.gemini\antigravity\brain\5f06a713-2916-49c3-90dc-f893a3592cf8\.system_generated\logs\transcript.jsonl"

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        data = json.loads(line)
        step = data.get('step_index')
        t_type = data.get('type')
        content = data.get('content', '')
        
        # Check if the step is run command or system response containing output
        if 'Get-Content' in content or 'transactionController.ts' in content or 'createTransaction' in content:
            # Let's print the step index and first 100 chars
            cmd_calls = []
            for tc in data.get('tool_calls', []):
                if tc.get('name') == 'run_command':
                    cmd_calls.append(tc.get('args', {}).get('CommandLine', ''))
            print(f"Step {step} (type: {t_type}): Cmd: {cmd_calls}")
            # If there is output or stdout in content, write it to step_content_{step}.txt
            if len(content) > 200:
                with open(f"step_content_{step}.txt", "w", encoding='utf-8') as out:
                    out.write(content)
                print(f"  -> Dumped content to step_content_{step}.txt ({len(content)} chars)")
