import { handle, ok, requireUser } from '@/lib/api';
import { cloudConfiguration } from '@/lib/ai/cloud';
export async function GET(){return handle(async()=>{await requireUser();return ok({active:process.env.LLM_PROVIDER ?? 'zai',providers:cloudConfiguration()});});}
