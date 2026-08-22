import React, {useMemo, useState} from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import TtsImport from "react-native-tts";

type Props = {visible: boolean; onClose: () => void};

type EmergencyLanguage = "en" | "ar" | "ru" | "de" | "fr" | "es";

type Phrase = {
  tr: string;
  translations: Record<EmergencyLanguage, string>;
};

const Tts: any = TtsImport as any;

const languageOptions: Array<{code: EmergencyLanguage; label: string; speech: string}> = [
  {code: "en", label: "🇬🇧 English", speech: "en-US"},
  {code: "ar", label: "🇸🇦 العربية", speech: "ar-SA"},
  {code: "ru", label: "🇷🇺 Русский", speech: "ru-RU"},
  {code: "de", label: "🇩🇪 Deutsch", speech: "de-DE"},
  {code: "fr", label: "🇫🇷 Français", speech: "fr-FR"},
  {code: "es", label: "🇪🇸 Español", speech: "es-ES"},
];

const phrases: Phrase[] = [
  {tr: "Yardıma ihtiyacım var.", translations: {en: "I need help.", ar: "أحتاج إلى مساعدة.", ru: "Мне нужна помощь.", de: "Ich brauche Hilfe.", fr: "J'ai besoin d'aide.", es: "Necesito ayuda."}},
  {tr: "Polisi arayın.", translations: {en: "Call the police.", ar: "اتصلوا بالشرطة.", ru: "Вызовите полицию.", de: "Rufen Sie die Polizei.", fr: "Appelez la police.", es: "Llame a la policía."}},
  {tr: "Ambulans çağırın.", translations: {en: "Call an ambulance.", ar: "اتصلوا بالإسعاف.", ru: "Вызовите скорую помощь.", de: "Rufen Sie einen Krankenwagen.", fr: "Appelez une ambulance.", es: "Llame a una ambulancia."}},
  {tr: "Hastaneye gitmem gerekiyor.", translations: {en: "I need to go to a hospital.", ar: "أحتاج إلى الذهاب إلى المستشفى.", ru: "Мне нужно в больницу.", de: "Ich muss ins Krankenhaus.", fr: "Je dois aller à l'hôpital.", es: "Necesito ir al hospital."}},
  {tr: "Doktora ihtiyacım var.", translations: {en: "I need a doctor.", ar: "أحتاج إلى طبيب.", ru: "Мне нужен врач.", de: "Ich brauche einen Arzt.", fr: "J'ai besoin d'un médecin.", es: "Necesito un médico."}},
  {tr: "Kayboldum.", translations: {en: "I am lost.", ar: "أنا تائه.", ru: "Я заблудился.", de: "Ich habe mich verirrt.", fr: "Je suis perdu.", es: "Estoy perdido."}},
  {tr: "Telefonumu kaybettim.", translations: {en: "I lost my phone.", ar: "فقدت هاتفي.", ru: "Я потерял телефон.", de: "Ich habe mein Telefon verloren.", fr: "J'ai perdu mon téléphone.", es: "Perdí mi teléfono."}},
  {tr: "Pasaportumu kaybettim.", translations: {en: "I lost my passport.", ar: "فقدت جواز سفري.", ru: "Я потерял паспорт.", de: "Ich habe meinen Reisepass verloren.", fr: "J'ai perdu mon passeport.", es: "Perdí mi pasaporte."}},
  {tr: "Ailemle iletişim kurmam gerekiyor.", translations: {en: "I need to contact my family.", ar: "أحتاج إلى التواصل مع عائلتي.", ru: "Мне нужно связаться с семьёй.", de: "Ich muss meine Familie kontaktieren.", fr: "Je dois contacter ma famille.", es: "Necesito contactar con mi familia."}},
  {tr: "Burada güvende değilim.", translations: {en: "I do not feel safe here.", ar: "لا أشعر بالأمان هنا.", ru: "Мне здесь небезопасно.", de: "Ich fühle mich hier nicht sicher.", fr: "Je ne me sens pas en sécurité ici.", es: "No me siento seguro aquí."}},
  {tr: "Alerjim var.", translations: {en: "I have an allergy.", ar: "لدي حساسية.", ru: "У меня аллергия.", de: "Ich habe eine Allergie.", fr: "J'ai une allergie.", es: "Tengo una alergia."}},
  {tr: "Bu ilacı kullanıyorum.", translations: {en: "I take this medicine.", ar: "أستخدم هذا الدواء.", ru: "Я принимаю это лекарство.", de: "Ich nehme dieses Medikament.", fr: "Je prends ce médicament.", es: "Tomo este medicamento."}},
  {tr: "Nefes almakta zorlanıyorum.", translations: {en: "I am having trouble breathing.", ar: "أجد صعوبة في التنفس.", ru: "Мне трудно дышать.", de: "Ich habe Schwierigkeiten zu atmen.", fr: "J'ai du mal à respirer.", es: "Tengo dificultad para respirar."}},
  {tr: "Şiddetli ağrım var.", translations: {en: "I am in severe pain.", ar: "أشعر بألم شديد.", ru: "У меня сильная боль.", de: "Ich habe starke Schmerzen.", fr: "J'ai très mal.", es: "Tengo un dolor intenso."}},
  {tr: "Lütfen yavaş konuşun.", translations: {en: "Please speak slowly.", ar: "من فضلك تحدث ببطء.", ru: "Пожалуйста, говорите медленнее.", de: "Bitte sprechen Sie langsam.", fr: "Parlez lentement, s'il vous plaît.", es: "Por favor, hable despacio."}},
  {tr: "Bu adresi bulmama yardım eder misiniz?", translations: {en: "Can you help me find this address?", ar: "هل يمكنك مساعدتي في العثور على هذا العنوان؟", ru: "Поможете мне найти этот адрес?", de: "Können Sie mir helfen, diese Adresse zu finden?", fr: "Pouvez-vous m'aider à trouver cette adresse ?", es: "¿Puede ayudarme a encontrar esta dirección?"}},
];

export default function EmergencyMode({visible, onClose}: Props) {
  const [language, setLanguage] = useState<EmergencyLanguage>("en");
  const selectedLanguage = useMemo(
    () => languageOptions.find(item => item.code === language) ?? languageOptions[0],
    [language],
  );

  const speak = async (value: string) => {
    try {
      await Tts.setDefaultLanguage(selectedLanguage.speech);
      Tts.stop();
      Tts.speak(value);
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>ÇEVRİMDIŞI HAZIR</Text>
            <Text style={styles.title}>🆘 Acil Durum</Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.description}>
          Temel ifadeler uygulamanın içinde kayıtlıdır. İnternet bağlantısı olmasa da ekranda gösterilebilir.
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.languages} contentContainerStyle={styles.languagesContent}>
          {languageOptions.map(item => (
            <TouchableOpacity
              key={item.code}
              style={[styles.languageChip, language === item.code && styles.languageChipActive]}
              onPress={() => setLanguage(item.code)}>
              <Text style={[styles.languageText, language === item.code && styles.languageTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {phrases.map((phrase, index) => {
            const translated = phrase.translations[language];
            return (
              <View key={`${phrase.tr}-${index}`} style={styles.card}>
                <Text style={styles.source}>{phrase.tr}</Text>
                <Text style={styles.translation} selectable>{translated}</Text>
                <TouchableOpacity style={styles.speakButton} onPress={() => void speak(translated)}>
                  <Text style={styles.speakText}>🔊 Seslendir</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: "#030817", paddingTop: 24},
  header: {flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18},
  eyebrow: {fontSize: 11, color: "#32D583", fontWeight: "900", letterSpacing: 1.2},
  title: {color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 4},
  closeButton: {width: 44, height: 44, borderRadius: 22, backgroundColor: "#13233E", alignItems: "center", justifyContent: "center"},
  closeText: {color: "#FFFFFF", fontSize: 18},
  description: {color: "#AFC7E6", lineHeight: 21, paddingHorizontal: 18, marginTop: 14},
  languages: {maxHeight: 58, marginTop: 14},
  languagesContent: {paddingHorizontal: 18, gap: 8, alignItems: "center"},
  languageChip: {borderRadius: 999, borderWidth: 1, borderColor: "#26476C", backgroundColor: "#0A1730", paddingHorizontal: 13, paddingVertical: 9},
  languageChipActive: {backgroundColor: "#0EA5E9", borderColor: "#36C8FF"},
  languageText: {color: "#B8CBE1", fontWeight: "800"},
  languageTextActive: {color: "#FFFFFF"},
  list: {padding: 18, paddingBottom: 36},
  card: {borderWidth: 1, borderColor: "#21436B", backgroundColor: "#0A1730", borderRadius: 18, padding: 16, marginBottom: 12},
  source: {color: "#8EA7C4", fontSize: 13, lineHeight: 19},
  translation: {color: "#FFFFFF", fontSize: 20, lineHeight: 28, fontWeight: "800", marginTop: 7},
  speakButton: {alignSelf: "flex-start", marginTop: 12, backgroundColor: "#123B5A", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10},
  speakText: {color: "#71DFFF", fontWeight: "800"},
});
