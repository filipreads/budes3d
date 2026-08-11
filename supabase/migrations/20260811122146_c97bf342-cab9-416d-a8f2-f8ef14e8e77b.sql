
CREATE POLICY "own uploads read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'portrait-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own uploads insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'portrait-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own uploads delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'portrait-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own models read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'portrait-models' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own models insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'portrait-models' AND auth.uid()::text = (storage.foldername(name))[1]);
