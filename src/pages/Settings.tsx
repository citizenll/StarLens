import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { githubService } from '@/lib/github';
import { aiService } from '@/lib/ai';
import { backupService } from '@/lib/backup';

export default function Settings() {
  const [githubToken, setGithubToken] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiBase, setOpenaiBase] = useState('');
  const [loading, setLoading] = useState(false);
  const [transfering, setTransfering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const settings = await db.settings.get('user_settings');
    if (settings) {
      setGithubToken(settings.github_token || '');
      setOpenaiKey(settings.openai_api_key || '');
      setOpenaiBase(settings.openai_api_base || '');
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await db.settings.put({
        id: 'user_settings',
        github_token: githubToken,
        openai_api_key: openaiKey,
        openai_api_base: openaiBase
      });

      // Re-init services
      if (githubToken) githubService.init(githubToken);
      if (openaiKey) aiService.init(openaiKey, openaiBase);

      toast.success('Settings saved successfully');
    } catch (error) {
      toast.error('Failed to save settings');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setTransfering(true);
    try {
      await backupService.download();
      toast.success('导出完成');
    } catch (e) {
      console.error(e);
      toast.error('导出失败');
    } finally {
      setTransfering(false);
    }
  };

  const handleImportFile = () => {
    fileInputRef.current?.click();
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTransfering(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await backupService.import(payload);
      await loadSettings();
      toast.success('导入完成');
    } catch (err) {
      console.error(err);
      toast.error('导入失败，请检查文件');
    } finally {
      setTransfering(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage your API keys and preferences.
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>GitHub Configuration</CardTitle>
            <CardDescription>
              Required to fetch your starred repositories.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Personal Access Token</label>
              <Input 
                type="password" 
                placeholder="ghp_..." 
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Generate a token with `read:user` scope at GitHub Settings.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Configuration</CardTitle>
            <CardDescription>
              Required for semantic search and auto-categorization.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">OpenAI API Key</label>
              <Input 
                type="password" 
                placeholder="sk-..." 
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">API Base URL (Optional)</label>
              <Input 
                placeholder="https://api.openai.com/v1" 
                value={openaiBase}
                onChange={(e) => setOpenaiBase(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={loading}>
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data Transfer</CardTitle>
          <CardDescription>导出/导入所有数据（设置、仓库、索引快照）。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={onFileSelected}
          />
          <Button variant="outline" onClick={handleExport} disabled={transfering}>
            导出数据
          </Button>
          <Button onClick={handleImportFile} disabled={transfering}>
            导入数据
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
