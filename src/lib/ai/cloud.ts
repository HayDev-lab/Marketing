import 'server-only';
export type CloudProvider = 'zai' | 'openrouter' | 'google';
export interface CloudPrompt { system?: string; prompt: string; json?: boolean; maxTokens?: number }
export function cloudConfiguration() {
 return [{id:'openrouter',configured:Boolean(process.env.OPENROUTER_API_KEY),model:process.env.OPENROUTER_MODEL ?? null},{id:'google',configured:Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),model:process.env.GEMINI_MODEL ?? null}];
}
export async function cloudComplete(provider: Exclude<CloudProvider,'zai'>, opts: CloudPrompt): Promise<string> {
 const key=provider==='openrouter'?process.env.OPENROUTER_API_KEY:(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
 const model=provider==='openrouter'?process.env.OPENROUTER_MODEL:process.env.GEMINI_MODEL;
 if(!key || !model) throw new Error(`${provider}: server API key and model must be configured`);
 const url=provider==='openrouter'?'https://openrouter.ai/api/v1/chat/completions':`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//,''))}:generateContent`;
 const body=provider==='openrouter'?{model,messages:[...(opts.system?[{role:'system',content:opts.system}]:[]),{role:'user',content:opts.prompt}],max_tokens:opts.maxTokens ?? 4096,...(opts.json?{response_format:{type:'json_object'}}:{})}:{contents:[{role:'user',parts:[{text:opts.prompt}]}],...(opts.system?{systemInstruction:{parts:[{text:opts.system}]}}:{}),generationConfig:{maxOutputTokens:opts.maxTokens ?? 4096,...(opts.json?{responseMimeType:'application/json'}:{})}};
 let response: Response;
 try {response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(provider==='openrouter'?{Authorization:`Bearer ${key}`}:{'x-goog-api-key':key})},body:JSON.stringify(body),signal:AbortSignal.timeout(60000),cache:'no-store'});}catch {throw new Error(`${provider}: connection failed or timed out; remote billing status is unknown. Check provider history before retrying.`);}
 if(!response.ok) throw new Error(`${provider}: HTTP ${response.status}. Check credentials, model access and limits. No automatic retry was sent; consult provider billing.`);
 const data=await response.json() as {choices?:{message?:{content?:string}}[];candidates?:{content?:{parts?:{text?:string}[]}}[]};
 const text=provider==='openrouter'?data.choices?.[0]?.message?.content:data.candidates?.[0]?.content?.parts?.map(p=>p.text ?? '').join('');
 if(!text) throw new Error(`${provider}: no text returned. Check safety restrictions and provider request history.`);
 return text;
}
