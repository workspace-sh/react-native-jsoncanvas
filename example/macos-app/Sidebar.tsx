// Left-side file list, styled after Workspace's desktop app sidebar so the
// two shells feel like the same family of app.
//
// Differences from Workspace's version:
//
//   - State is *passed as props* rather than read from Zustand. The harness
//     keeps everything in App.tsx's useState — no global store, no
//     dependency on `zustand`, no `setActiveFile` action plumbing.
//   - First entry is a non-closable "sample" pinned at the top so the
//     harness has something to render on first launch.
//
// Layout / colour decisions match Workspace's so the two shells feel like
// the same family of app. Sidebar width 220, system-blue "Open File"
// button (#0a84ff), uppercase "FILES" header, hairline-bordered separator.
import React from 'react';
import {FlatList, Pressable, StyleSheet, Text, View, useColorScheme} from 'react-native';

export interface OpenedFile {
  id: string;
  name: string;
  content: string;
  /** Absolute path to the file's directory — used as `basePath` for
   *  resolving relative image references inside the canvas. Absent for
   *  the bundled sample. */
  basePath?: string;
}

interface Props {
  files: OpenedFile[];
  activeId: string;
  /** ID of the always-present sample tab — never gets a × close button. */
  pinnedId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: () => void;
  /** Whether the native FilePicker module is available. Hides the Open
   *  button when running in an environment without it (web, sim without
   *  the module linked, etc.). */
  canOpen: boolean;
}

function FileItem({
  file,
  isActive,
  isPinned,
  onActivate,
  onClose,
  isDark,
}: {
  file: OpenedFile;
  isActive: boolean;
  isPinned: boolean;
  onActivate: () => void;
  onClose: () => void;
  isDark: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.fileItem,
        isActive && (isDark ? styles.fileItemActiveDark : styles.fileItemActiveLight),
      ]}
      onPress={onActivate}>
      <Text
        style={[styles.fileName, !isDark && styles.fileNameLight]}
        numberOfLines={1}>
        {file.name}
      </Text>
      {!isPinned && (
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.closeButton}>×</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

export function Sidebar({files, activeId, pinnedId, onActivate, onClose, onOpen, canOpen}: Props) {
  const isDark = useColorScheme() === 'dark';
  return (
    <View
      style={[
        styles.container,
        isDark ? styles.containerDark : styles.containerLight,
      ]}>
      <Text style={[styles.header, !isDark && styles.headerLight]}>Files</Text>
      {canOpen && (
        <Pressable style={styles.openButton} onPress={onOpen}>
          <Text style={styles.openButtonText}>Open File</Text>
        </Pressable>
      )}
      <FlatList
        data={files}
        keyExtractor={f => f.id}
        renderItem={({item}) => (
          <FileItem
            file={item}
            isActive={item.id === activeId}
            isPinned={item.id === pinnedId}
            onActivate={() => onActivate(item.id)}
            onClose={() => onClose(item.id)}
            isDark={isDark}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 220,
    borderRightWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  containerDark: {
    backgroundColor: '#1c1c1e',
    borderRightColor: '#3a3a3c',
  },
  containerLight: {
    backgroundColor: '#f2f2f7',
    borderRightColor: '#c6c6c8',
  },
  header: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  // Workspace uses the same #8e8e93 in both modes; we follow.
  headerLight: {},
  openButton: {
    backgroundColor: '#0a84ff',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  openButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  fileItemActiveDark: {
    backgroundColor: '#2c2c2e',
  },
  fileItemActiveLight: {
    backgroundColor: '#d1d1d6',
  },
  fileName: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
  },
  fileNameLight: {
    color: '#1c1c1e',
  },
  closeButton: {
    color: '#8e8e93',
    fontSize: 16,
    marginLeft: 4,
  },
  separator: {
    height: 2,
  },
});
