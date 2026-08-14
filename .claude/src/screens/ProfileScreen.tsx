import React, {useEffect, useMemo, useState} from "react";
import {ActivityIndicator, Alert, Modal, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View} from "react-native";
import StatCard from "../components/profile/StatCard";
import {DEFAULT_USER_PROFILE, deleteUserProfile, loadUserProfile, saveUserProfile} from "../services/profileStorage";
import type {ProfileUsage, UserProfile} from "../types/profile";

type LanguageStat = {name: string; count: number};
type ActivityItem = {id: string; icon: string; title: string; detail: string; createdAt: string};

type Props = {
  visible: boolean;
  usage: ProfileUsage;
  topLanguages: LanguageStat[];
  recentActivities: ActivityItem[];
  onClose: () => void;
};

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export default function ProfileScreen({visible, usage, topLanguages, recentActivities, onClose}: Props) {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [draft, setDraft] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    loadUserProfile().then(saved => {setProfile(saved); setDraft(saved);}).finally(() => setLoading(false));
  }, [visible]);

  const initials = useMemo(() => profile.name.split(/\s+/).slice(0, 2).map(v => v[0]?.toUpperCase()).join("") || "AY", [profile.name]);
  const totalUsage = usage.translations + usage.conferences + usage.aiMessages;
  const weekly = useMemo(() => {
    const seed = Math.max(totalUsage, 7);
    return DAYS.map((day, index) => ({day, value: Math.max(1, Math.round(seed * ([0.09,0.14,0.11,0.18,0.16,0.19,0.13][index])))}));
  }, [totalUsage]);
  const maxWeekly = Math.max(...weekly.map(item => item.value), 1);
  const languageTotal = Math.max(topLanguages.reduce((sum, item) => sum + item.count, 0), 1);
  const badges = [
    {icon:"🌍", title:"İlk Çeviri", unlocked: usage.translations > 0},
    {icon:"👥", title:"İlk Toplantı", unlocked: usage.conferences > 0},
    {icon:"✨", title:"AI Kaşifi", unlocked: usage.aiMessages >= 10},
    {icon:"🏆", title:"100 Çeviri", unlocked: usage.translations >= 100},
  ];

  const save = async () => {
    if (!draft.name.trim()) return Alert.alert("AyTalk", "Ad alanı boş olamaz.");
    if (draft.email && !/^\S+@\S+\.\S+$/.test(draft.email)) return Alert.alert("AyTalk", "Geçerli bir e-posta yaz.");
    const next = await saveUserProfile({...draft, name: draft.name.trim(), email: draft.email.trim()});
    setProfile(next); setDraft(next); setEditing(false);
  };

  const toggle = async (key: "notificationsEnabled" | "localHistoryEnabled", value: boolean) => {
    const next = {...profile, [key]: value}; setProfile(next); setDraft(next); await saveUserProfile(next);
  };

  const reset = () => Alert.alert("Profil verilerini sil", "Profil bilgileri cihazdan silinsin mi?", [
    {text:"Vazgeç",style:"cancel"},
    {text:"Sil",style:"destructive",onPress:async()=>{await deleteUserProfile();setProfile(DEFAULT_USER_PROFILE);setDraft(DEFAULT_USER_PROFILE);setEditing(false);}},
  ]);

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.back}><Text style={styles.backText}>‹</Text></TouchableOpacity>
        <View style={{flex:1}}><Text style={styles.title}>AyTalk Dashboard</Text><Text style={styles.sub}>Profil, kullanım ve başarıların</Text></View>
        <TouchableOpacity style={styles.edit} onPress={()=>setEditing(v=>!v)}><Text style={styles.editText}>{editing?"Vazgeç":"Düzenle"}</Text></TouchableOpacity>
      </View>
      {loading ? <View style={styles.loading}><ActivityIndicator size="large" color="#4BC6FF"/></View> : <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profile}><View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View><View style={{flex:1,marginLeft:14}}><Text style={styles.name}>{profile.name}</Text><Text style={styles.meta}>{profile.email||"E-posta eklenmedi"}</Text><Text style={styles.meta}>{profile.country} · {profile.preferredLanguage}</Text></View><Text style={styles.badge}>{profile.premium?"PREMIUM":"ÜCRETSİZ"}</Text></View>
        {editing && <View style={styles.card}><Text style={styles.sectionInside}>Profil bilgileri</Text><TextInput style={styles.input} value={draft.name} onChangeText={name=>setDraft({...draft,name})} placeholder="Ad" placeholderTextColor="#7F9AB9"/><TextInput style={styles.input} value={draft.email} onChangeText={email=>setDraft({...draft,email})} placeholder="E-posta" placeholderTextColor="#7F9AB9" autoCapitalize="none" keyboardType="email-address"/><TextInput style={styles.input} value={draft.preferredLanguage} onChangeText={preferredLanguage=>setDraft({...draft,preferredLanguage})} placeholder="Tercih edilen dil" placeholderTextColor="#7F9AB9"/><TextInput style={styles.input} value={draft.country} onChangeText={country=>setDraft({...draft,country})} placeholder="Ülke" placeholderTextColor="#7F9AB9"/><TouchableOpacity style={styles.save} onPress={save}><Text style={styles.saveText}>Profili Kaydet</Text></TouchableOpacity></View>}

        <Text style={styles.section}>Kullanım özeti</Text><View style={styles.grid}><StatCard icon="🌍" value={usage.translations} label="Çeviri"/><StatCard icon="👥" value={usage.conferences} label="Toplantı"/><StatCard icon="✨" value={usage.aiMessages} label="AI mesajı"/><StatCard icon="★" value={usage.favorites} label="Favori"/></View>

        <Text style={styles.section}>Bu haftaki aktivite</Text>
        <View style={styles.chartCard}><View style={styles.chartHeader}><Text style={styles.cardTitle}>Haftalık kullanım</Text><Text style={styles.chartTotal}>{totalUsage} işlem</Text></View><View style={styles.chart}>{weekly.map(item=><View key={item.day} style={styles.barWrap}><Text style={styles.barValue}>{item.value}</Text><View style={styles.barTrack}><View style={[styles.bar,{height:`${Math.max(14,(item.value/maxWeekly)*100)}%`}]} /></View><Text style={styles.day}>{item.day}</Text></View>)}</View></View>

        <Text style={styles.section}>En çok kullanılan diller</Text>
        <View style={styles.card}>{topLanguages.length===0?<Text style={styles.empty}>Dil istatistiği için çeviri yapmaya başla.</Text>:topLanguages.map(item=>{const percent=Math.round(item.count/languageTotal*100);return <View key={item.name} style={styles.languageRow}><View style={styles.languageTop}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.percent}>%{percent}</Text></View><View style={styles.progressTrack}><View style={[styles.progress,{width:`${percent}%`}]} /></View></View>})}</View>

        <Text style={styles.section}>Başarı rozetleri</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{badges.map(item=><View key={item.title} style={[styles.badgeCard,!item.unlocked&&styles.locked]}><Text style={styles.badgeIcon}>{item.icon}</Text><Text style={styles.badgeTitle}>{item.title}</Text><Text style={styles.badgeState}>{item.unlocked?"Kazanıldı":"Kilitli"}</Text></View>)}</ScrollView>

        <View style={styles.premiumCard}><View><Text style={styles.premiumEyebrow}>AYTALK PREMIUM</Text><Text style={styles.premiumTitle}>Sınırları kaldır</Text><Text style={styles.premiumBody}>Gelişmiş konferans, daha yüksek limitler, premium sesler ve video çeviri.</Text></View><TouchableOpacity style={styles.premiumButton}><Text style={styles.premiumButtonText}>Yakında</Text></TouchableOpacity></View>

        <Text style={styles.section}>Son aktiviteler</Text><View style={styles.card}>{recentActivities.length===0?<Text style={styles.empty}>Henüz aktivite yok.</Text>:recentActivities.map(item=><View key={item.id} style={styles.activity}><Text style={styles.activityIcon}>{item.icon}</Text><View style={{flex:1}}><Text style={styles.rowTitle}>{item.title}</Text><Text style={styles.meta} numberOfLines={1}>{item.detail}</Text></View><Text style={styles.activityTime}>{new Date(item.createdAt).toLocaleDateString()}</Text></View>)}</View>

        <Text style={styles.section}>Tercihler</Text><View style={styles.card}><View style={styles.settingRow}><View style={{flex:1}}><Text style={styles.rowTitle}>Bildirimler</Text><Text style={styles.meta}>Önemli AyTalk bildirimleri</Text></View><Switch value={profile.notificationsEnabled} onValueChange={v=>void toggle("notificationsEnabled",v)}/></View><View style={styles.settingRow}><View style={{flex:1}}><Text style={styles.rowTitle}>Yerel geçmiş kaydı</Text><Text style={styles.meta}>Geçmişi bu cihazda sakla</Text></View><Switch value={profile.localHistoryEnabled} onValueChange={v=>void toggle("localHistoryEnabled",v)}/></View><TouchableOpacity style={styles.settingRow} onPress={reset}><Text style={[styles.rowTitle,{color:"#FF5C6C"}]}>Profil verilerini sil</Text></TouchableOpacity></View>
      </ScrollView>}
    </SafeAreaView>
  </Modal>;
}

const styles=StyleSheet.create({container:{flex:1,backgroundColor:"#050A18"},header:{minHeight:72,flexDirection:"row",alignItems:"center",padding:14,borderBottomWidth:1,borderBottomColor:"#20365C",backgroundColor:"#071226"},back:{width:42,height:42,borderRadius:21,backgroundColor:"#132341",alignItems:"center",justifyContent:"center",marginRight:12},backText:{color:"#fff",fontSize:32},title:{color:"#fff",fontSize:19,fontWeight:"900"},sub:{color:"#7F9AB9",fontSize:11},edit:{backgroundColor:"#132E62",borderRadius:12,paddingHorizontal:12,paddingVertical:9},editText:{color:"#4BC6FF",fontWeight:"900"},loading:{flex:1,alignItems:"center",justifyContent:"center"},content:{padding:14,paddingBottom:48},profile:{flexDirection:"row",alignItems:"center",backgroundColor:"#0B1730",borderWidth:1,borderColor:"#224879",borderRadius:22,padding:16},avatar:{width:72,height:72,borderRadius:36,backgroundColor:"#132E62",borderWidth:2,borderColor:"#4BC6FF",alignItems:"center",justifyContent:"center"},avatarText:{color:"#fff",fontSize:24,fontWeight:"900"},name:{color:"#fff",fontSize:18,fontWeight:"900"},meta:{color:"#AFC7E6",fontSize:11,marginTop:4},badge:{color:"#F5B83D",fontSize:9,fontWeight:"900"},section:{color:"#fff",fontSize:15,fontWeight:"900",marginTop:20,marginBottom:10},sectionInside:{color:"#fff",fontSize:15,fontWeight:"900",marginBottom:2},grid:{flexDirection:"row",flexWrap:"wrap",justifyContent:"space-between",gap:10},card:{backgroundColor:"#0B1730",borderWidth:1,borderColor:"#20365C",borderRadius:20,padding:14},cardTitle:{color:"#fff",fontSize:14,fontWeight:"900"},input:{minHeight:48,borderWidth:1,borderColor:"#20365C",borderRadius:13,paddingHorizontal:12,color:"#fff",marginTop:10,backgroundColor:"#0E1C39"},save:{minHeight:50,borderRadius:14,backgroundColor:"#1E56FF",alignItems:"center",justifyContent:"center",marginTop:14},saveText:{color:"#fff",fontWeight:"900"},chartCard:{backgroundColor:"#0B1730",borderWidth:1,borderColor:"#20365C",borderRadius:20,padding:14},chartHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},chartTotal:{color:"#4BC6FF",fontSize:12,fontWeight:"900"},chart:{height:170,flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between",marginTop:14},barWrap:{width:"12%",height:"100%",alignItems:"center",justifyContent:"flex-end"},barValue:{color:"#AFC7E6",fontSize:9,marginBottom:4},barTrack:{width:18,height:118,borderRadius:10,backgroundColor:"#132341",justifyContent:"flex-end",overflow:"hidden"},bar:{width:"100%",borderRadius:10,backgroundColor:"#1E56FF"},day:{color:"#7F9AB9",fontSize:9,marginTop:7},languageRow:{marginBottom:14},languageTop:{flexDirection:"row",justifyContent:"space-between"},rowTitle:{color:"#fff",fontSize:13,fontWeight:"800"},percent:{color:"#4BC6FF",fontSize:11,fontWeight:"900"},progressTrack:{height:8,borderRadius:4,backgroundColor:"#132341",marginTop:8,overflow:"hidden"},progress:{height:"100%",borderRadius:4,backgroundColor:"#4BC6FF"},empty:{color:"#7F9AB9",fontSize:12,lineHeight:18},badgeCard:{width:126,minHeight:116,borderRadius:18,padding:14,marginRight:10,backgroundColor:"#0B1730",borderWidth:1,borderColor:"#294E80"},locked:{opacity:.42},badgeIcon:{fontSize:28},badgeTitle:{color:"#fff",fontSize:12,fontWeight:"900",marginTop:9},badgeState:{color:"#4BC6FF",fontSize:10,marginTop:4},premiumCard:{minHeight:126,borderRadius:22,padding:18,marginTop:22,backgroundColor:"#171526",borderWidth:1,borderColor:"#6B4E19"},premiumEyebrow:{color:"#F5B83D",fontSize:10,fontWeight:"900",letterSpacing:1},premiumTitle:{color:"#fff",fontSize:20,fontWeight:"900",marginTop:5},premiumBody:{color:"#AFC7E6",fontSize:11,lineHeight:17,marginTop:5,paddingRight:90},premiumButton:{position:"absolute",right:16,bottom:16,backgroundColor:"#3D2D08",borderRadius:12,paddingHorizontal:14,paddingVertical:9},premiumButtonText:{color:"#F5B83D",fontSize:11,fontWeight:"900"},activity:{minHeight:62,flexDirection:"row",alignItems:"center",borderBottomWidth:1,borderBottomColor:"#20365C"},activityIcon:{fontSize:22,width:36},activityTime:{color:"#7F9AB9",fontSize:9,marginLeft:8},settingRow:{minHeight:64,flexDirection:"row",alignItems:"center",borderBottomWidth:1,borderBottomColor:"#20365C",paddingVertical:10}});
