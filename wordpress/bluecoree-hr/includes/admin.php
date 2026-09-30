<?php
defined('ABSPATH') || exit;

function bluecoree_hr_admin_menu(): void {
    add_menu_page('BlueCoreeHR', 'BlueCoreeHR', 'manage_options', 'bluecoree-hr', 'bluecoree_hr_admin_page', 'dashicons-groups', 30);
}

function bluecoree_hr_setup(): void {
    global $wpdb;
    if (!current_user_can('manage_options')) wp_die('Administrator access required.', '', ['response' => 403]);
    check_admin_referer('bluecoree_hr_setup');
    $action = sanitize_key(wp_unslash($_POST['hr_action'] ?? ''));
    $message = 'Saved.';
    try {
        if ($action === 'company') {
            $code = strtoupper(sanitize_text_field(wp_unslash($_POST['code'] ?? '')));
            $name = sanitize_text_field(wp_unslash($_POST['name'] ?? ''));
            $timezone = sanitize_text_field(wp_unslash($_POST['timezone'] ?? 'Asia/Kolkata'));
            $plan = sanitize_text_field(wp_unslash($_POST['plan'] ?? 'BASIC'));
            if (!preg_match('/^[A-Z0-9_-]{2,64}$/D', $code) || $name === '' || strlen($name) > 191 || !in_array($plan, ['BASIC', 'ADVANCED'], true) || !in_array($timezone, DateTimeZone::listIdentifiers(), true)) throw new RuntimeException('Enter a valid company code, name, plan and timezone.');
            if (false === $wpdb->insert(bluecoree_hr_table('companies'), ['code' => $code, 'name' => $name, 'plan' => $plan, 'timezone' => $timezone, 'created_at' => gmdate('Y-m-d H:i:s')])) throw new RuntimeException('Could not create company. Check whether the code already exists.');
            bluecoree_hr_audit((int) $wpdb->insert_id, 'COMPANY_CREATED', (int) $wpdb->insert_id);
        } elseif ($action === 'employee') {
            $company = absint($_POST['company'] ?? 0);
            if (!$wpdb->get_var($wpdb->prepare('SELECT id FROM ' . bluecoree_hr_table('companies') . ' WHERE id=%d AND status=%s', $company, 'ACTIVE'))) throw new RuntimeException('Choose an active company.');
            $email = sanitize_email(wp_unslash($_POST['email'] ?? ''));
            $name = sanitize_text_field(wp_unslash($_POST['name'] ?? ''));
            $code = sanitize_text_field(wp_unslash($_POST['employee_code'] ?? ''));
            $department = sanitize_text_field(wp_unslash($_POST['department'] ?? ''));
            $designation = sanitize_text_field(wp_unslash($_POST['designation'] ?? ''));
            if (!is_email($email) || email_exists($email) || username_exists($email) || $name === '' || strlen($name) > 191 || !preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $code) || strlen($department) > 191 || strlen($designation) > 191) throw new RuntimeException('Enter a new valid email, name and employee code. Existing WordPress accounts cannot be reassigned here.');
            $user_id = wp_insert_user(['user_login' => $email, 'user_email' => $email, 'display_name' => $name, 'user_pass' => wp_generate_password(32, true), 'role' => 'bluecoree_employee']);
            if (is_wp_error($user_id)) throw new RuntimeException('Could not create employee account.');
            $saved = $wpdb->insert(bluecoree_hr_table('employees'), ['company_id' => $company, 'user_id' => $user_id, 'employee_code' => $code, 'department' => $department, 'designation' => $designation, 'created_at' => gmdate('Y-m-d H:i:s')]);
            if ($saved === false) {
                require_once ABSPATH . 'wp-admin/includes/user.php';
                wp_delete_user($user_id);
                throw new RuntimeException('Could not save employee. Check whether the employee code already exists.');
            }
            bluecoree_hr_audit($company, 'EMPLOYEE_CREATED', (int) $wpdb->insert_id);
            wp_new_user_notification($user_id, null, 'user');
            $message = 'Employee created. WordPress sent a password setup email; check email delivery in the hosting panel.';
        } elseif ($action === 'plan') {
            $company = absint($_POST['company'] ?? 0);
            $plan = sanitize_text_field(wp_unslash($_POST['plan'] ?? ''));
            $status = sanitize_text_field(wp_unslash($_POST['status'] ?? ''));
            if (!in_array($plan, ['BASIC', 'ADVANCED'], true) || !in_array($status, ['ACTIVE', 'SUSPENDED'], true) || !$wpdb->get_var($wpdb->prepare('SELECT id FROM ' . bluecoree_hr_table('companies') . ' WHERE id=%d', $company))) throw new RuntimeException('Choose a valid company, plan and status.');
            if (false === $wpdb->update(bluecoree_hr_table('companies'), ['plan' => $plan, 'status' => $status], ['id' => $company])) throw new RuntimeException('Could not update company plan.');
            bluecoree_hr_audit($company, 'PLAN_UPDATED', $company);
        } else throw new RuntimeException('Unknown action.');
    } catch (Throwable $error) { $message = $error->getMessage(); }
    wp_safe_redirect(add_query_arg(['page' => 'bluecoree-hr', 'notice' => $message], admin_url('admin.php')));
    exit;
}

function bluecoree_hr_admin_form_start(string $action): void {
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('bluecoree_hr_setup');
    echo '<input type="hidden" name="action" value="bluecoree_hr_setup"><input type="hidden" name="hr_action" value="' . esc_attr($action) . '">';
}

function bluecoree_hr_company_select(array $companies): void {
    echo '<label>Company <select name="company" required>';
    foreach ($companies as $company) echo '<option value="' . esc_attr($company['id']) . '">' . esc_html($company['name'] . ' (' . $company['code'] . ')') . '</option>';
    echo '</select></label> ';
}

function bluecoree_hr_admin_page(): void {
    global $wpdb;
    if (!current_user_can('manage_options')) return;
    $companies = $wpdb->get_results('SELECT * FROM ' . bluecoree_hr_table('companies') . ' ORDER BY name', ARRAY_A);
    $employees = $wpdb->get_results('SELECT e.employee_code, e.company_id, u.display_name, u.user_email, e.active FROM ' . bluecoree_hr_table('employees') . ' e JOIN ' . $wpdb->users . ' u ON u.ID=e.user_id ORDER BY e.id DESC LIMIT 100', ARRAY_A);
    $attendance = $wpdb->get_results('SELECT a.*, e.employee_code, u.display_name FROM ' . bluecoree_hr_table('attendance') . ' a JOIN ' . bluecoree_hr_table('employees') . ' e ON e.id=a.employee_id AND e.company_id=a.company_id JOIN ' . $wpdb->users . ' u ON u.ID=e.user_id ORDER BY a.id DESC LIMIT 100', ARRAY_A);
    echo '<div class="wrap"><h1>BlueCoreeHR setup</h1>';
    if (isset($_GET['notice'])) echo '<div class="notice notice-info"><p>' . esc_html(sanitize_text_field(wp_unslash($_GET['notice']))) . '</p></div>';
    echo '<p><strong>Release scope:</strong> employee accounts, profiles, plan status and face attendance. This release does not replace existing payroll, advanced HR modules, historical data or the native mobile API.</p>';
    echo '<h2>Hosting readiness</h2><ul>';
    $checks = ['PHP 8.2+' => PHP_VERSION_ID >= 80200, 'OpenSSL encryption' => function_exists('openssl_encrypt'), 'HTTPS site URL' => str_starts_with(home_url(), 'https://'), 'Face and liveness provider credentials' => bluecoree_hr_provider_ready()];
    foreach ($checks as $label => $ok) echo '<li>' . esc_html($label . ': ' . ($ok ? 'Ready' : 'Needs setup')) . '</li>';
    echo '</ul><p>The provider and encryption key are configured in wp-config.php. Node.js, Composer, shell functions and background workers are not required by this plugin.</p>';
    $portal = get_option('bluecoree_hr_portal_page');
    if ($portal) echo '<p><a href="' . esc_url(get_permalink($portal)) . '">Open employee portal</a></p>';
    echo '<h2>Create company</h2>';
    bluecoree_hr_admin_form_start('company');
    echo '<p><label>Company name <input name="name" required maxlength="191"></label> <label>Code <input name="code" required maxlength="64"></label> <label>Timezone <input name="timezone" value="Asia/Kolkata" required></label> <label>Plan <select name="plan"><option>BASIC</option><option>ADVANCED</option></select></label></p><button class="button button-primary">Create company</button></form>';
    if ($companies) {
        echo '<h2>Create employee login</h2>';
        bluecoree_hr_admin_form_start('employee');
        bluecoree_hr_company_select($companies);
        echo '<p><label>Name <input name="name" required maxlength="191"></label> <label>Email <input type="email" name="email" required></label> <label>Employee code <input name="employee_code" required maxlength="64"></label></p><p><label>Department <input name="department" maxlength="191"></label> <label>Designation <input name="designation" maxlength="191"></label></p><button class="button button-primary">Create employee and send password setup email</button></form>';
        echo '<h2>Manage company plan</h2>';
        bluecoree_hr_admin_form_start('plan');
        bluecoree_hr_company_select($companies);
        echo '<select name="plan"><option>BASIC</option><option>ADVANCED</option></select> <select name="status"><option>ACTIVE</option><option>SUSPENDED</option></select> <button class="button">Save plan and status</button></form>';
    }
    echo '<h2>Companies</h2><table class="widefat"><thead><tr><th>Name</th><th>Code</th><th>Plan</th><th>Status</th></tr></thead><tbody>';
    foreach ($companies as $row) echo '<tr><td>' . esc_html($row['name']) . '</td><td>' . esc_html($row['code']) . '</td><td>' . esc_html($row['plan']) . '</td><td>' . esc_html($row['status']) . '</td></tr>';
    echo '</tbody></table><h2>Employees (latest 100)</h2><table class="widefat"><thead><tr><th>Company ID</th><th>Name</th><th>Login email</th><th>Employee code</th></tr></thead><tbody>';
    foreach ($employees as $row) echo '<tr><td>' . esc_html($row['company_id']) . '</td><td>' . esc_html($row['display_name']) . '</td><td>' . esc_html($row['user_email']) . '</td><td>' . esc_html($row['employee_code']) . '</td></tr>';
    echo '</tbody></table><h2>Attendance (latest 100; timestamps UTC)</h2><table class="widefat"><thead><tr><th>Employee</th><th>Company ID</th><th>Work date</th><th>Check-in</th><th>Check-out</th></tr></thead><tbody>';
    foreach ($attendance as $row) echo '<tr><td>' . esc_html($row['display_name'] . ' (' . $row['employee_code'] . ')') . '</td><td>' . esc_html($row['company_id']) . '</td><td>' . esc_html($row['work_date']) . '</td><td>' . esc_html($row['check_in']) . '</td><td>' . esc_html($row['check_out'] ?? '—') . '</td></tr>';
    echo '</tbody></table></div>';
}
