# FM-DX Webserver Updater Plugin (v0.0.7)

An advanced management tool for FM-DX Webserver plugins, allowing you to monitor, update, and install new components directly from the web interface.

## Key Features

- **Automatic Version Checking**: Compares local plugin versions with those available on GitHub.
- **Smart Installation**: The verification function (🔍 icon) automatically scans GitHub repositories to find descriptor files and configure local paths.
- **Recursive Download**: Supports complex plugins by downloading entire directories and maintaining subfolder structures (e.g., assets, CSS, frontend scripts).
- **Full Management**: Allows you to safely install, update, reinstall, and remove plugins.
- **File Viewer**: Includes a read-only editor to inspect local files and verify update results.
- **Flexible UI Integration**: Options to display the Updater in the plugin panel, the top header bar, or the setup page.

## Requirements and Installation

1. Copy the descriptor file `Updater.js` into your server's `plugins/` folder.
2. Copy the `Updater/` folder (containing `pluginUpdater.js`, `pluginUpdater_server.js`, etc.) into the `plugins/` folder.
3. Restart the FM-DX Webserver.
4. Ensure you are logged in as an **Administrator** to view the interface.

## Usage

- **Updating**: If a new version is available, an "Update" button will appear next to the plugin status.
- **Adding Plugins**: Click "Add new plugin", paste a GitHub repository URL, and use the 🔍 button to auto-complete descriptor and folder details.
- **Deletion**: Removing a plugin deletes both the descriptor file and its associated local directory, updating metadata.
- **Options (Gear Icon)**: 
    - Manage the visibility of the Updater button.
    - View internal configuration files (`new_data.json` and `pl_data.json`).
    - Run "Merge New Data" to consolidate newly installed plugins into the static database.

## Project Structure

- `pluginUpdater.js`: Frontend logic, modal management, and user interface.
- `pluginUpdater_server.js`: Backend endpoints for downloading, filesystem scanning, and GitHub API interaction.
- `pl_data.json`: Static database of known repositories.
- `new_data.json`: Dynamic file storing manually added plugins or path overrides.

## Technical Notes

- **Security**: The backend ensures that all read/write operations occur exclusively within the `plugins/` directory.
- **GitHub API**: Uses the GitHub Tree and Contents APIs to accurately map files, even for repositories that organize plugins into subfolders (e.g., a `plugins/` folder on GitHub).
- **Caching**: Implements cache-busting mechanisms (timestamp `?t=`) to ensure that displayed versions are always the most recent.

---
*Developed for the FM-DX Webserver Ecosystem.*