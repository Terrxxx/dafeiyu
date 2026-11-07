import { markdownData } from './markdown-input.js';
import fs from 'node:fs';
const divisions=JSON.parse(fs.readFileSync(new URL('./china-regions.json',import.meta.url)));
const districtIndex=new Map(divisions.provinces.flatMap(p=>p.cities.flatMap(c=>c.districts.map(d=>[d.code,{...d,city:c.name,region:p.name}]))));
const taiwan=divisions.provinces.find(p=>p.code==='710000');
const fields = 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day';
export function normalizeWeather(value = {}) {
  const config = { enabled: true, city: '深圳', region: '广东', countryCode: 'CN', refreshMinutes: 30, ...value };
  if (typeof config.enabled !== 'boolean' || typeof config.city !== 'string' || !config.city.trim() || config.city.length > 80 || !/^[A-Z]{2}$/.test(config.countryCode) || !Number.isInteger(config.refreshMinutes) || config.refreshMinutes < 15 || config.refreshMinutes > 180) throw new Error('天气配置：城市1至80字、国家两位大写代码、刷新间隔15至180分钟');
  if (typeof config.region !== 'string' || config.region.length > 80) throw new Error('天气省份须为最多80字的文本，可留空');
  if(config.districtCode){const area=districtIndex.get(String(config.districtCode));if(!area||!Number.isFinite(area.latitude)||!Number.isFinite(area.longitude))throw Error('所选行政区无效或缺少坐标');Object.assign(config,{districtCode:area.code,district:area.name,city:area.city,region:area.region,countryCode:'CN',latitude:area.latitude,longitude:area.longitude});}
  if(!config.districtCode&&config.region===taiwan.name&&config.city===taiwan.name)Object.assign(config,{district:'',latitude:taiwan.latitude,longitude:taiwan.longitude,countryCode:'CN'});
  config.city = config.city.trim(); config.region = config.region.trim(); return config;
}
export function weatherDescription(code) {
  if (code === 0) return '晴'; if ([1, 2, 3].includes(code)) return '晴间多云或阴';
  if ([45, 48].includes(code)) return '雾'; if (code >= 51 && code <= 67) return '雨';
  if (code >= 71 && code <= 77 || [85, 86].includes(code)) return '雪';
  if ([80, 81, 82].includes(code)) return '阵雨'; if ([95, 96, 99].includes(code)) return '雷雨'; return '天气类型未知';
}
export function weatherEmotion(current) {
  const delta = {}; const add = changes => { for (const [key, value] of Object.entries(changes)) delta[key] = Math.max(-5, Math.min(5, (delta[key] || 0) + value)); };
  if (current.temperature_2m >= 30) add({ irritation: 1, excitement: -1 });
  if (current.temperature_2m <= 10) add({ calm: -1, tenderness: 1 });
  if (current.apparent_temperature >= 32) add({ irritation: 2, calm: -2, joy: -1 });
  else if (current.apparent_temperature <= 5) add({ worry: 1, security: -1 });
  else if (current.apparent_temperature >= 18 && current.apparent_temperature <= 28) add({ joy: 1, calm: 1 });
  if (current.relative_humidity_2m >= 80) add({ irritation: 1, calm: -1 });
  else if (current.relative_humidity_2m <= 30) add({ irritation: 1, tenderness: -1 });
  else if (current.relative_humidity_2m >= 40 && current.relative_humidity_2m <= 70) add({ calm: 1, security: 1 });
  if (current.wind_speed_10m >= 35) add({ worry: 2, calm: -2, anticipation: -1 });
  else if (current.wind_speed_10m >= 8 && current.wind_speed_10m <= 20 && current.apparent_temperature >= 18 && current.apparent_temperature <= 28) add({ joy: 1, inspiration: 1 });
  if ([95, 96, 99].includes(current.weather_code)) add({ worry: 2, security: -2 });
  else if (current.precipitation > 0) add({ calm: 1, tenderness: 1 });
  else if (current.is_day === 1 && current.weather_code <= 2) add({ joy: 1, curiosity: 1, anticipation: 1 });
  return delta;
}
export class LocalWeather {
  constructor(config, store, feelings, request = fetch, now = Date.now) {
    this.config = normalizeWeather(config); this.store = store; this.feelings = feelings; this.request = request; this.now = now;
    this.key = `${this.config.city}:${this.config.region}:${this.config.countryCode}${this.config.districtCode?':'+this.config.districtCode:''}`; this.pending = null; this.nextAttempt = 0;
  }
  snapshot() {
    if (!this.config.enabled) return { enabled: false };
    const data = this.store.data.weather;
    if (!data || data.locationKey !== this.key) return { enabled: true, city: this.config.city, available: false };
    const age = this.now() - data.fetchedAt;
    return { ...data, enabled: true, available: age >= 0 && age <= 2 * 3600000, stale: age > this.config.refreshMinutes * 60000 };
  }
  async json(url) {
    this.assertAwake?.();
    const response = await this.request(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`天气服务 HTTP ${response.status}`);
    return response.json();
  }
  async refresh() {
    this.assertAwake?.();
    if (!this.config.enabled) return this.snapshot();
    if (this.pending) return this.pending;
    const saved = this.snapshot();
    if (this.now() < this.nextAttempt || saved.available && !saved.stale) return saved;
    this.nextAttempt = this.now() + 5 * 60000;
    this.pending = this.update().finally(() => { this.pending = null; });
    return this.pending;
  }
  async update() {
    let location = this.store.data.weather?.locationKey === this.key ? this.store.data.weather.location : null;
    if(this.config.districtCode||this.config.region===taiwan.name&&this.config.city===taiwan.name)location={name:this.config.district||this.config.city,city:this.config.city,region:this.config.region,latitude:this.config.latitude,longitude:this.config.longitude};
    if (!location) {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({ name: this.config.city, count: '10', language: 'zh', countryCode: this.config.countryCode });
      const data = await this.json(url);
      const region = text => String(text || '').replace(/省$|市$/, '');
      const matches = (data.results || []).filter(item => item.country_code === this.config.countryCode && item.name === this.config.city && (!this.config.region || region(item.admin1) === region(this.config.region)));
      if (matches.length !== 1) throw new Error('天气城市未找到或存在重名，请在Web配置中填写准确城市名');
      const item = matches[0]; location = { name: item.name, region: item.admin1, latitude: item.latitude, longitude: item.longitude };
    }
    if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) throw new Error('天气位置数据无效');
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), current: fields, timezone: 'Asia/Shanghai', timeformat: 'unixtime', forecast_days: '1' });
    const data = await this.json(url); this.assertAwake?.(); const current = data.current;
    if (!current || fields.split(',').some(key => !Number.isFinite(current[key])) || !Number.isFinite(current.time) || Math.abs(this.now() - current.time * 1000) > 2 * 3600000 || current.temperature_2m < -90 || current.temperature_2m > 65 || current.relative_humidity_2m < 0 || current.relative_humidity_2m > 100 || current.precipitation < 0 || current.wind_speed_10m < 0) throw new Error('天气服务返回缺失、过期或无效数据');
    const weather = { locationKey: this.key, location, city: this.config.city, district:this.config.district||null, source: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/', fetchedAt: this.now(), observedAt: current.time * 1000,
      temperature: current.temperature_2m, feelsLike: current.apparent_temperature, humidity: current.relative_humidity_2m,
      precipitation: current.precipitation, windKmh: current.wind_speed_10m, code: current.weather_code, isDay: current.is_day === 1, description: weatherDescription(current.weather_code) };
    this.store.data.weather = weather;
    const delta = weatherEmotion(current);
    this.feelings.event(`weather:${this.key}:${Math.floor(current.time / 3600)}`, delta, 'weather');
    this.store.save(); return this.snapshot();
  }
  prompt() {
    const weather = this.snapshot();
    if (!weather.enabled) return '';
    if (!weather.available) return `\n配置城市${this.config.city}：当前没有有效的天气数据，不猜天气；需要时清醒后可用local_weather读取。`;
    return '\n本地天气（配置城市的模型估计，不是窗外实测，不代表对话用户所在地）：' + markdownData(weather) +
      '\n可结合天气、自己的情绪与当前话题，自主选择宅着看视频、找话题、用应景表情、轻松感叹或保持安静；下雨不必难过，晴天不必兴奋。同一天气也可有不同选择。不每轮播报，不批量提醒，不假装淋雨或实际出门；提醒用户前确认其城市，过期数据不能当实时天气。天气不改变睡眠规则或精力。';
  }
}
