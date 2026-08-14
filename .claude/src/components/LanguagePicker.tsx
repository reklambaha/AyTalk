import React from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {LANGUAGES} from "../constants/languages";
import type {Language} from "../types";

type LanguagePickerProps = {
  visible: boolean;
  title: string;
  selected: Language;
  onSelect: (language: Language) => void;
  onClose: () => void;
};

export default function LanguagePicker({
  visible,
  title,
  selected,
  onSelect,
  onClose,
}: LanguagePickerProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView>
            {LANGUAGES.map(language => {
              const active = language.name === selected.name;

              return (
                <TouchableOpacity
                  key={language.name}
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => {
                    onSelect(language);
                    onClose();
                  }}>
                  <Text style={styles.flag}>{language.flag}</Text>
                  <View style={styles.textWrap}>
                    <Text style={styles.nativeName}>{language.nativeName}</Text>
                    <Text style={styles.englishName}>{language.name}</Text>
                  </View>
                  {active ? <Text style={styles.check}>✓</Text> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(4,15,32,0.68)",
    justifyContent: "flex-end",
  },
  card: {
    maxHeight: "82%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: "#123F88",
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 19,
    backgroundColor: "#EAF3FF",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    fontSize: 18,
    color: "#084C9E",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 15,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  rowActive: {
    backgroundColor: "#EAF3FF",
  },
  flag: {
    fontSize: 30,
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
  },
  nativeName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#1E2C40",
  },
  englishName: {
    fontSize: 13,
    color: "#6E7D91",
    marginTop: 2,
  },
  check: {
    fontSize: 22,
    color: "#16A3E6",
    fontWeight: "900",
  },
});
