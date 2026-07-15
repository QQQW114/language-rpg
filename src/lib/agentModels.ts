import { DEFAULT_SETTINGS,type AppSettings } from '@/types/settings';
const clean=(v:unknown)=>String(v??'').trim()||undefined;
export const resolveStoryModel=(s:AppSettings)=>clean(s.storyModel)||DEFAULT_SETTINGS.storyModel;
export const resolvePlannerModel=(s:AppSettings)=>clean(s.plannerModel)||resolveStoryModel(s);
