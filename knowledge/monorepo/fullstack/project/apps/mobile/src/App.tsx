import React, { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { getLessons, totalMinutes } from '@kv/domain';
import { parseLessonsResponse, type LessonSummary } from '@kv/contracts';
// Real iPhone: replace with the computer's LAN IP; localhost points to the phone.
const API = process.env.EXPO_PUBLIC_API_URL;
export default function App() {
  const [lessons, setLessons] = useState<readonly LessonSummary[]>(getLessons().lessons);
  const [status, setStatus] = useState('离线共享领域数据');
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    if (!API) return;
    const controller = new AbortController();
    fetch(`${API}/api/lessons`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<unknown>; })
      .then(x => { const data = parseLessonsResponse(x); setLessons(data.lessons); setStatus('NestJS API 连通 · 契约验证成功'); })
      .catch(err => { if (!controller.signal.aborted) setStatus(`API 不可用，继续离线显示：${String(err)}`); });
    return () => controller.abort();
  }, [refreshToken]);
  return <SafeAreaView style={s.root}><StatusBar style="light"/><ScrollView contentContainerStyle={s.page}>
    <Text testID="kv-title" style={s.kicker}>KNOWVERSE / NATIVE RUNTIME</Text><Text style={s.title}>相同的知识，{'\n'}<Text style={s.highlight}>原生的体验</Text></Text>
    <Text style={s.explain}>React Native 真正渲染 Text、View、ScrollView，并调用与 Web 同一份共享领域逻辑。</Text>
    <Text testID="kv-api-status" style={s.status}>{status}</Text><Pressable testID="kv-api-refresh" accessibilityRole="button" accessibilityLabel="重新验证 API" onPress={() => { setStatus("正在重新验证 API…"); setRefreshToken(n => n + 1); }} style={s.refresh}><Text style={s.refreshText}>重新验证 API</Text></Pressable><Text testID="kv-lesson-summary" style={s.meta}>{lessons.length} 节课程 · {totalMinutes(lessons)} 分钟</Text>
    {lessons.map((x,i)=><View key={x.id} style={s.card}><Text style={s.number}>LESSON {i+1} / {x.level}</Text><Text style={s.cardTitle}>{x.title}</Text><Text style={s.minutes}>{x.minutes} 分钟</Text></View>)}
    <Text style={s.footer}>@kv/contracts · @kv/domain · Expo SDK 58</Text>
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#091522'},page:{padding:26,paddingTop:56,paddingBottom:80},kicker:{color:'#9ce3ce',fontSize:11,letterSpacing:2},title:{fontSize:42,lineHeight:52,color:'#eafaf6',fontWeight:'800',marginTop:20},highlight:{color:'#86e7c9'},explain:{color:'#b1c4c7',lineHeight:25,marginVertical:17,fontSize:15},status:{color:'#8ce0cb',padding:14,backgroundColor:'#12323c',borderRadius:10,overflow:'hidden'},refresh:{marginTop:14,padding:15,borderRadius:12,borderWidth:1,borderColor:'#68d7c2',alignItems:'center'},refreshText:{color:'#9ce9d9',fontWeight:'700'},meta:{color:'#c4d6df',fontSize:16,marginVertical:21},card:{borderRadius:16,borderWidth:1,borderColor:'#315262',backgroundColor:'#14293b',padding:22,marginBottom:13},number:{color:'#90e4d3',fontSize:11},cardTitle:{color:'#fff',fontSize:20,fontWeight:'700',marginVertical:13},minutes:{color:'#a9bcc6'},footer:{color:'#7e9ca6',marginTop:28}});
