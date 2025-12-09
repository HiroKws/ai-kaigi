
export class DebugLogger {
  private static logs: string[] = [];

  static log(model: string, prompt: string, response: string | null, error: string | null) {
    const timestamp = new Date().toISOString();
    const status = error ? "ERROR" : "SUCCESS";
    
    const entry = `
================================================================================
TIMESTAMP: ${timestamp}
MODEL: ${model}
STATUS: ${status}
--------------------------------------------------------------------------------
[PROMPT]
${prompt}
--------------------------------------------------------------------------------
[${error ? 'ERROR DETAILS' : 'RESPONSE TEXT'}]
${error || response}
================================================================================
`;
    this.logs.push(entry);
    console.log(`[DebugLogger] Recorded interaction for ${model}`);
  }

  static getLogs(): string {
    return this.logs.join('\n');
  }

  static clear() {
    this.logs = [];
  }

  static downloadLogs() {
    if (this.logs.length === 0) {
      alert("No logs to download.");
      return;
    }

    const element = document.createElement("a");
    const file = new Blob([this.getLogs()], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = "prompt_logs.txt";
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();
    document.body.removeChild(element);
  }
}
