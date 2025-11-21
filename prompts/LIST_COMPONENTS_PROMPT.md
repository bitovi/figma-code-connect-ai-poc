
// Legacy prompt (no longer used in the pipeline). Kept for archival reference.


Given `conflg.json` file, list all components defined in it with their names and types and their relative paths.
I want the output to be in JSON array format with the following schema:

```json
    {
        "componentName": <COMPONENT_NAME>,
        "componentType": <COMPONENT_TYPE>,
        "relativePath": <RELATIVE_PATH_TO_COMPONENT>
    }
```


Write the JSON array to `components_info/components-list.json`
