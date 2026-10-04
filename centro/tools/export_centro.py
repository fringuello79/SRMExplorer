# Riesporta la scena del centro modificata in Blender -> SRMExplorer/centro/assets/centro_edit.glb
# (l'app la carica al posto della scena generata; aprire con ?gen per vedere di nuovo quella generata).
# Da lanciare dentro Blender con magliano_centro_v2.blend aperto (Scripting > Run, oppure via MCP).
import bpy, os
OUT = r"C:\Users\fring\Documents\GitHub\SRMExplorer\centro\assets\centro_edit.glb"
# si esporta tutto cio' che e' visibile, tranne Lino (lo mette l'app)
for o in bpy.data.objects:
    o.select_set(o.visible_get() and not o.name.startswith('Lino'))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
    export_yup=True, export_image_format='AUTO', export_jpeg_quality=82, export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6, export_texcoords=True, export_normals=True, export_materials='EXPORT')
print('scritto', OUT, os.path.getsize(OUT))
