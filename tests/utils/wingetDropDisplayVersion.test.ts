import { describe, expect, it } from 'vitest'
import { dropDisplayVersion } from '../../scripts/winget-drop-display-version.mjs'

/**
 * winget-pkgs のメンテナーから「DisplayVersion が PackageVersion と同じなら消すべき」と
 * 毎回指摘される。Komac (winget-releaser) は重複を新しい版を書き込む前に比べるので
 * 消し損ねる。PR を作った後に installer マニフェストから落とす。Komac の書式
 * (インデントと並び) はそのまま残す
 */

// Komac v2.17.1 が 1.94.0 で出したもの
const KOMAC = `# Created with WinGet Releaser using komac v2.17.1
# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.12.0.schema.json

PackageIdentifier: NotedeckDev.NoteDeck
PackageVersion: 1.94.0
InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
ProductCode: NoteDeck
ReleaseDate: 2026-10-24
AppsAndFeaturesEntries:
- Publisher: notedeck
  DisplayVersion: 1.94.0
  ProductCode: NoteDeck
InstallationMetadata:
  DefaultInstallLocation: '%LocalAppData%\\NoteDeck'
Installers:
- Architecture: x64
  InstallerUrl: https://github.com/notedeck-dev/notedeck/releases/download/v1.94.0/NoteDeck-1.94.0-windows-x64-setup.exe
  InstallerSha256: 7B7E9CC6C875F545191C1702258855430833C96D205071771C6EE279C44B0292
ManifestType: installer
ManifestVersion: 1.12.0
`

describe('dropDisplayVersion', () => {
  it('PackageVersion と同じ DisplayVersion の行だけを落とし、ほかはそのまま', () => {
    const out = dropDisplayVersion(KOMAC, '1.94.0')
    expect(out).toBe(KOMAC.replace('  DisplayVersion: 1.94.0\n', ''))
  })

  it('エントリーの先頭の項目だったら、次の項目を先頭に繰り上げる', () => {
    const text =
      'AppsAndFeaturesEntries:\n- DisplayVersion: 1.94.0\n  ProductCode: NoteDeck\nInstallers: []\n'
    expect(dropDisplayVersion(text, '1.94.0')).toBe(
      'AppsAndFeaturesEntries:\n- ProductCode: NoteDeck\nInstallers: []\n',
    )
  })

  it('エントリーが DisplayVersion だけなら、エントリーごと消し、空になった一覧も消す', () => {
    const text =
      'Scope: user\nAppsAndFeaturesEntries:\n- DisplayVersion: 1.94.0\nInstallers: []\n'
    expect(dropDisplayVersion(text, '1.94.0')).toBe(
      'Scope: user\nInstallers: []\n',
    )
  })

  it('インストーラーごとの一覧 (字下げあり) でも、引用符つきの値でも落とす', () => {
    const text =
      "Installers:\n- Architecture: x64\n  AppsAndFeaturesEntries:\n  - Publisher: notedeck\n    DisplayVersion: '1.94.0'\n"
    expect(dropDisplayVersion(text, '1.94.0')).toBe(
      'Installers:\n- Architecture: x64\n  AppsAndFeaturesEntries:\n  - Publisher: notedeck\n',
    )
  })

  it('PackageVersion と違う DisplayVersion は残す (意味のある値)', () => {
    expect(dropDisplayVersion(KOMAC, '1.95.0')).toBe(KOMAC)
    const text =
      'AppsAndFeaturesEntries:\n- Publisher: notedeck\n  DisplayVersion: 1.94.0.0\n'
    expect(dropDisplayVersion(text, '1.94.0')).toBe(text)
  })
})
